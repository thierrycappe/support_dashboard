import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { appendAuditEvent } from '@/lib/audit/events'
import { createChannel, updateChannel } from '@/lib/routing/channels'
import { createGroup, setGroupMembers } from '@/lib/routing/groups'
import { getRoutingContext, setAppPolicy } from '@/lib/routing/policies'
import { parseChannelKeyring } from '@/lib/routing/crypto'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const keyring = parseChannelKeyring(JSON.stringify({
  active: 'v1',
  keys: { v1: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
}))
const mutation = { actorId: 'admin-1', correlationId: 'routing-test', reason: 'routing test' }

beforeEach(async () => {
  await getDb().execute(sql`truncate table audit_events, source_apps, support_groups, support_users cascade`)
  await getDb().execute(sql`
    insert into support_users (id, email, name, role, status, password_hash, created_at, updated_at)
    values ('admin-1', 'admin@example.test', 'Admin', 'ADMIN', 'ACTIVE', 'hash', now(), now()),
           ('member-1', 'member@example.test', 'Member', 'SUPPORT', 'ACTIVE', 'hash', now(), now())
  `)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
    values ('app-1', 'routing-app', 'Routing App', 'test', 'ACTIVE', 'ACTIVE', 'LEGACY_BEARER', now(), now())
  `)
})

afterAll(async () => { await closeDbPool() })

describe('routing repositories', () => {
  it('enforces exactly one central fallback under concurrent creation', async () => {
    const attempts = await Promise.allSettled([
      createGroup({ name: 'Central A', isCentralFallback: true, ...mutation }),
      createGroup({ name: 'Central B', isCentralFallback: true, ...mutation }),
    ])
    const fulfilled = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof createGroup>>> => attempt.status === 'fulfilled')
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((await scalar(sql`select count(*)::int as count from support_groups where is_central_fallback`))).toBe(1)
    expect(await auditActions()).toEqual(['GROUP_CREATED'])
    expect(fulfilled[0]?.value.isCentralFallback).toBe(true)
  })

  it('rejects duplicate group members before replacing the membership set', async () => {
    const group = await createGroup({ name: 'Owners', ...mutation })
    await setGroupMembers({ groupId: group.id, members: [{ supportUserId: 'member-1' }], ...mutation })
    await expect(setGroupMembers({
      groupId: group.id,
      members: [{ supportUserId: 'member-1' }, { supportUserId: 'member-1' }],
      ...mutation,
    })).rejects.toThrow('Duplicate group member')
    expect(await scalar(sql`select count(*)::int as count from support_group_members where group_id = ${group.id}`)).toBe(1)
  })

  it('persists only encrypted channel configuration and returns a redacted channel', async () => {
    const group = await createGroup({ name: 'Channel owners', ...mutation })
    const channel = await createChannel({
      groupId: group.id,
      name: 'Primary email',
      type: 'EMAIL',
      config: { to: ['alerts@example.test'] },
      includeReporterContext: true,
      keyring,
      ...mutation,
    })
    const stored = await getDb().execute<{ encryptedConfig: string; nonce: string; authTag: string }>(sql`
      select encrypted_config as "encryptedConfig", config_nonce as nonce, config_auth_tag as "authTag"
      from notification_channels where id = ${channel.id}
    `)
    expect(JSON.stringify(stored.rows[0])).not.toContain('alerts@example.test')
    expect(channel).toMatchObject({
      name: 'Primary email', type: 'EMAIL', includeReporterContext: true,
      destinationLabel: expect.not.stringContaining('alerts@example.test'),
    })
    expect(channel).not.toHaveProperty('config')
    expect(JSON.stringify(await auditRows())).not.toContain('alerts@example.test')
  })

  it('updates channel ciphertext without exposing configuration through reads or audit', async () => {
    const group = await createGroup({ name: 'Channel updates', ...mutation })
    const channel = await createChannel({ groupId: group.id, name: 'Webhook', type: 'PUSHOVER', config: { appToken: 'token-one', userKey: 'user-one' }, keyring, ...mutation })
    const updated = await updateChannel({ id: channel.id, config: { appToken: 'token-two', userKey: 'user-two' }, keyring, ...mutation })
    const stored = await getDb().execute<{ encryptedConfig: string }>(sql`select encrypted_config as "encryptedConfig" from notification_channels where id = ${channel.id}`)
    expect(stored.rows[0]?.encryptedConfig).not.toContain('token-two')
    expect(updated).not.toHaveProperty('config')
    expect(JSON.stringify(await auditRows())).not.toMatch(/token-(one|two)|user-(one|two)/)
  })

  it('replaces app policy and app group atomically, with a non-secret audit trail', async () => {
    const group = await createGroup({ name: 'App owners', ...mutation })
    await createChannel({
      groupId: group.id, name: 'Owners email', type: 'EMAIL',
      config: { to: ['owners@example.test'] }, keyring, ...mutation,
    })
    await setAppPolicy({
      sourceAppId: 'app-1', technicalGroupId: group.id, minimumPriority: 'HIGH',
      urgentCentralCopy: false, fallbackToCentral: true, ...mutation,
    })
    await expect(setAppPolicy({
      sourceAppId: 'app-1', technicalGroupId: 'missing-group', minimumPriority: 'LOW',
      urgentCentralCopy: true, fallbackToCentral: false, ...mutation,
    })).rejects.toThrow()
    const preserved = await getRoutingContext({ sourceAppId: 'app-1' })
    expect(preserved).toMatchObject({
      technicalGroupId: group.id,
      policy: { minimumPriority: 'HIGH', urgentCentralCopy: false, fallbackToCentral: true },
    })
    expect(JSON.stringify(preserved)).not.toContain('owners@example.test')
    await setAppPolicy({
      sourceAppId: 'app-1', technicalGroupId: null, minimumPriority: 'LOW',
      urgentCentralCopy: true, fallbackToCentral: false, ...mutation,
    })
    const context = await getRoutingContext({ sourceAppId: 'app-1' })
    expect(context).toMatchObject({ technicalGroupId: null, policy: { minimumPriority: 'LOW', urgentCentralCopy: true, fallbackToCentral: false } })
    expect(JSON.stringify(context)).not.toContain('owners@example.test')
    expect((await scalar(sql`select count(*)::int as count from app_notification_policies where source_app_id = 'app-1'`))).toBe(1)
    expect(await auditActions()).toContain('APP_POLICY_SET')
  })

  it('appends immutable, non-secret audit records', async () => {
    const audit = await appendAuditEvent({ action: 'ROUTING_READ', subjectType: 'support_group', subjectId: 'subject-1', ...mutation })
    expect(audit).toMatchObject({ action: 'ROUTING_READ', actorId: 'admin-1', requestCorrelationId: 'routing-test' })
    expect(await scalar(sql`select count(*)::int as count from audit_events where id = ${audit.id}`)).toBe(1)
    await expect(appendAuditEvent({
      action: 'BAD_REASON', subjectType: 'channel', subjectId: 'x', metadata: { reason: 'override' }, ...mutation,
    })).rejects.toThrow('Reserved audit metadata is not allowed')
    await expect(appendAuditEvent({ action: 'BAD', subjectType: 'channel', subjectId: 'x', metadata: { ciphertext: 'never-store-this' }, ...mutation })).rejects.toThrow('Sensitive audit metadata is not allowed')
  })

  it('does not lock a channel during slow validation and rejects a changed revision', async () => {
    const group = await createGroup({ name: 'Concurrent channel', ...mutation })
    const channel = await createChannel({ groupId: group.id, name: 'Concurrent', type: 'PUSHOVER', config: { appToken: 'token-one', userKey: 'user-one' }, keyring, ...mutation })
    let releaseValidation!: () => void
    let validationStarted!: () => void
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve })
    const validationStartedGate = new Promise<void>((resolve) => { validationStarted = resolve })
    const slowUpdate = updateChannel({
      id: channel.id, config: { appToken: 'token-two', userKey: 'user-two' }, keyring, ...mutation,
      validateConfig: async (_type, config) => {
        validationStarted()
        await validationGate
        return { type: 'PUSHOVER', ...(config as { appToken: string; userKey: string }) }
      },
    })
    await validationStartedGate
    await expect(updateChannel({ id: channel.id, status: 'DISABLED', ...mutation })).resolves.toMatchObject({ status: 'DISABLED' })
    releaseValidation()
    await expect(slowUpdate).rejects.toThrow('Channel changed during configuration validation')
    expect((await getRoutingContext({ sourceAppId: 'app-1' })).technicalChannels).toEqual([])
    const row = await getDb().execute<{ status: string; encryptedConfig: string }>(sql`select status, encrypted_config as "encryptedConfig" from notification_channels where id = ${channel.id}`)
    expect(row.rows[0]).toMatchObject({ status: 'DISABLED' })
    expect(row.rows[0]?.encryptedConfig).not.toContain('token-two')
  })

  it('rejects a channel type change that races configuration validation', async () => {
    const group = await createGroup({ name: 'Type channel', ...mutation })
    const channel = await createChannel({ groupId: group.id, name: 'Type race', type: 'PUSHOVER', config: { appToken: 'token-one', userKey: 'user-one' }, keyring, ...mutation })
    let releaseValidation!: () => void
    let validationStarted!: () => void
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve })
    const validationStartedGate = new Promise<void>((resolve) => { validationStarted = resolve })
    const slowUpdate = updateChannel({
      id: channel.id, config: { appToken: 'token-two', userKey: 'user-two' }, keyring, ...mutation,
      validateConfig: async (_type, config) => {
        validationStarted()
        await validationGate
        return { type: 'PUSHOVER', ...(config as { appToken: string; userKey: string }) }
      },
    })
    await validationStartedGate
    await getDb().execute(sql`update notification_channels set type = 'EMAIL', updated_at = now() where id = ${channel.id}`)
    releaseValidation()
    await expect(slowUpdate).rejects.toThrow('Channel changed during configuration validation')
  })
})

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(query)
  return rows.rows[0]?.count ?? 0
}

async function auditActions(): Promise<string[]> {
  const rows = await getDb().execute<{ action: string }>(sql`select action from audit_events order by created_at, id`)
  return rows.rows.map((row) => row.action)
}

async function auditRows(): Promise<unknown[]> {
  const rows = await getDb().execute(sql`select actor_id, action, subject_type, subject_id, metadata, request_correlation_id from audit_events order by created_at, id`)
  return rows.rows
}
