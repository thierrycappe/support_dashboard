import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb, getDbPool, type DbTransaction } from '@/lib/db'
import { backfillSupportRouting } from '@/scripts/backfill-support-routing'
import { acceptLegacyPayload } from '@/lib/escalations/legacy'
import { ROUTING_CUTOVER_ADVISORY_LOCK } from '@/lib/routing/cutover'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
process.env.SUPPORT_TOWER_PUBLIC_URL = 'https://support.example.test'

const encryptionKeys = JSON.stringify({
  active: 'v1',
  keys: { v1: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
})
const fullEnv = {
  PUSHOVER_APP_TOKEN: 'backfill-app-token',
  PUSHOVER_USER_KEY: 'backfill-user-key',
  SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON: encryptionKeys,
}

let actorId: string

beforeEach(async () => {
  actorId = `migration-actor:${randomUUID()}`
  // Audit evidence is append-only: isolate this suite with a unique actor id
  // instead of truncating its history.
  await getDb().execute(sql`truncate table source_apps, support_groups, support_settings cascade`)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
    values ('backfill-app-a', 'backfill-a', 'Backfill A', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', now(), now()),
           ('backfill-app-b', 'backfill-b', 'Backfill B', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', now(), now())
  `)
})

afterAll(async () => { await closeDbPool() })

describe('backfillSupportRouting', () => {
  it('creates the central encrypted Pushover route and app policies once', async () => {
    const first = await backfillSupportRouting({ db: getDb(), env: fullEnv, actorId })
    const second = await backfillSupportRouting({ db: getDb(), env: fullEnv, actorId })

    expect(first).toEqual({ centralGroupsCreated: 1, channelsCreated: 1, policiesCreated: 2, appsChanged: 2, bridgeRetired: true })
    expect(second).toEqual({ centralGroupsCreated: 0, channelsCreated: 0, policiesCreated: 0, appsChanged: 0, bridgeRetired: false })
    expect(await scalar(sql`select count(*)::int as count from support_groups where is_central_fallback`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from notification_channels where name = 'Central Pushover'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from app_notification_policies`)).toBe(2)
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'SUPPORT_ROUTING_BACKFILLED' and actor_id = ${actorId}`)).toBe(2)
    expect(await scalar(sql`select count(*)::int as count from source_apps where technical_group_id is null or credential_mode <> 'LEGACY_BEARER'`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from support_settings where key = 'legacy_pushover_bridge_retired_at'`)).toBe(1)
    expect(JSON.stringify(await auditRows())).not.toContain('backfill-app-token')
    expect(JSON.stringify(await auditRows())).not.toContain('backfill-user-key')
  })

  it('does not create a channel or retire the bridge with only one Pushover value', async () => {
    const result = await backfillSupportRouting({
      db: getDb(), env: { PUSHOVER_APP_TOKEN: 'present', SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON: encryptionKeys }, actorId,
    })

    expect(result).toMatchObject({ channelsCreated: 0, bridgeRetired: false })
    expect(await scalar(sql`select count(*)::int as count from notification_channels`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from app_notification_policies`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from support_settings where key = 'legacy_pushover_bridge_retired_at'`)).toBe(0)
    await acceptLegacyPayload({
      db: getDb(), env: fullEnv, authoritativeAppSlug: 'backfill-a', idempotencyKey: 'partial-env',
      payload: { app: { slug: 'backfill-a', name: 'Backfill A', environment: 'test' }, ticket: { externalId: 'partial-1', kind: 'BUG', status: 'NEW', priority: 'MEDIUM', title: 'Partial', description: 'Partial' } },
    })
    expect(await scalar(sql`select count(*)::int as count from delivery_outbox where config_source = 'LEGACY_ENV'`)).toBe(1)
  })

  it('routes each accepted event to exactly one legacy or database target across cutover', async () => {
    let cutoverLocked!: () => void
    const locked = new Promise<void>((resolve) => { cutoverLocked = resolve })
    let releaseCutover!: () => void
    const release = new Promise<void>((resolve) => { releaseCutover = resolve })
    let backfillPid: number | undefined
    const backfill = backfillSupportRouting({
      db: getDb(), env: fullEnv, actorId,
      onRoutingLock: async (tx) => { backfillPid = await backendPid(tx); cutoverLocked(); await release },
    })
    await locked
    let intakeLockAcquired!: () => void
    const intakeAcquired = new Promise<void>((resolve) => { intakeLockAcquired = resolve })
    let intakePid: number | undefined
    const intake = acceptLegacyPayload({
      db: getDb(), env: fullEnv, authoritativeAppSlug: 'backfill-a', idempotencyKey: `race-${randomUUID()}`,
      payload: { app: { slug: 'backfill-a', name: 'Backfill A', environment: 'test' }, ticket: { externalId: 'race-1', kind: 'BUG', status: 'NEW', priority: 'MEDIUM', title: 'Race', description: 'Race' } },
      onRoutingLockAcquired: async (tx) => { intakePid = await backendPid(tx); intakeLockAcquired(); await release },
    })
    try {
      const pair = await waitForRoutingLockWaiter({ holderPid: backfillPid })
      releaseCutover()
      await Promise.all([backfill, intake, intakeAcquired])
      expect(intakePid).toBe(pair.waiterPid)
    } finally {
      releaseCutover()
      await Promise.allSettled([backfill, intake])
    }

    const targets = await getDb().execute<{ eventId: string; targetKey: string; configSource: string }>(sql`
      select escalation_event_id as "eventId", target_key as "targetKey", config_source as "configSource"
        from delivery_outbox order by escalation_event_id, target_key
    `)
    expect(targets.rows).toHaveLength(1)
    expect(targets.rows[0]).toMatchObject({ configSource: 'DATABASE' })
    expect(targets.rows[0]?.targetKey).toMatch(/^channel:/)
    expect(await scalar(sql`select count(*)::int as count from delivery_outbox group by escalation_event_id having count(*) <> 1`)).toBe(0)
  })

  it.each([
    ['disabled central group', sql`
      insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('central-disabled', 'Central support', 'DISABLED', true, now(), now())
    `],
    ['disabled central Pushover channel', sql`
      insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('central-active', 'Central support', 'ACTIVE', true, now(), now());
      insert into notification_channels (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at)
      values ('central-channel', 'central-active', 'Central Pushover', 'PUSHOVER', 'DISABLED', 'invalid', 'invalid', 'invalid', 1, now(), now())
    `],
    ['wrong-type central channel', sql`
      insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('central-active', 'Central support', 'ACTIVE', true, now(), now());
      insert into notification_channels (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at)
      values ('central-channel', 'central-active', 'Central Pushover', 'EMAIL', 'ACTIVE', 'invalid', 'invalid', 'invalid', 1, now(), now())
    `],
    ['undecryptable central Pushover channel', sql`
      insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('central-active', 'Central support', 'ACTIVE', true, now(), now());
      insert into notification_channels (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at)
      values ('central-channel', 'central-active', 'Central Pushover', 'PUSHOVER', 'ACTIVE', 'invalid', 'invalid', 'invalid', 1, now(), now())
    `],
  ])('does not retire the bridge when the existing route has %s', async (_label, setup) => {
    await getDb().execute(setup)

    await expect(backfillSupportRouting({ db: getDb(), env: fullEnv, actorId })).rejects.toThrow()

    expect(await scalar(sql`select count(*)::int as count from app_notification_policies`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from support_settings where key = 'legacy_pushover_bridge_retired_at'`)).toBe(0)
  })

  it('does not convert a PUBLIC_KEY app added after bridge retirement, but installs its policy and audits it', async () => {
    await backfillSupportRouting({ db: getDb(), env: fullEnv, actorId })
    await getDb().execute(sql`
      insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values ('post-cutover-public-key', 'post-cutover', 'Post cutover', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', now(), now())
    `)

    const rerun = await backfillSupportRouting({ db: getDb(), env: fullEnv, actorId })

    expect(rerun).toEqual({ centralGroupsCreated: 0, channelsCreated: 0, policiesCreated: 1, appsChanged: 1, bridgeRetired: false })
    expect(await scalar(sql`select count(*)::int as count from source_apps where id = 'post-cutover-public-key' and credential_mode = 'PUBLIC_KEY' and technical_group_id is null`)).toBe(1)
    const rows = await getDb().execute<{ metadata: { changes?: string[] } }>(sql`
      select metadata from audit_events where actor_id = ${actorId} and subject_id = 'post-cutover-public-key'
    `)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.metadata.changes).toEqual(['policy'])
  })

  it('allows simultaneous serializable backfills with one changing transaction and one idempotent transaction', async () => {
    const [first, second] = await Promise.all([
      backfillSupportRouting({ db: getDb(), env: fullEnv, actorId: `${actorId}:first` }),
      backfillSupportRouting({ db: getDb(), env: fullEnv, actorId: `${actorId}:second` }),
    ])

    expect([first, second].filter((summary) => summary.appsChanged > 0)).toHaveLength(1)
    expect([first, second].filter((summary) => summary.appsChanged === 0)).toHaveLength(1)
    expect(await scalar(sql`select count(*)::int as count from support_groups where is_central_fallback`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from notification_channels where name = 'Central Pushover'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from app_notification_policies`)).toBe(2)
  })

  it('keeps the legacy target when intake obtains the routing lock before cutover', async () => {
    let intakeLocked!: () => void
    const locked = new Promise<void>((resolve) => { intakeLocked = resolve })
    let releaseIntake!: () => void
    const release = new Promise<void>((resolve) => { releaseIntake = resolve })
    let intakePid: number | undefined
    const intake = acceptLegacyPayload({
      db: getDb(), env: fullEnv, authoritativeAppSlug: 'backfill-a', idempotencyKey: `inverse-race-${randomUUID()}`,
      payload: { app: { slug: 'backfill-a', name: 'Backfill A', environment: 'test' }, ticket: { externalId: 'inverse-race-1', kind: 'BUG', status: 'NEW', priority: 'MEDIUM', title: 'Inverse race', description: 'Inverse race' } },
      onRoutingLockAcquired: async (tx) => { intakePid = await backendPid(tx); intakeLocked(); await release },
    })
    await locked
    let backfillPid: number | undefined
    const backfill = backfillSupportRouting({
      db: getDb(), env: fullEnv, actorId,
      onRoutingLock: async (tx) => { backfillPid = await backendPid(tx) },
    })
    try {
      const pair = await waitForRoutingLockWaiter({ holderPid: intakePid })
      releaseIntake()
      await Promise.all([intake, backfill])
      expect(backfillPid).toBe(pair.waiterPid)
    } finally {
      releaseIntake()
      await Promise.allSettled([intake, backfill])
    }

    const targets = await getDb().execute<{ configSource: string }>(sql`
      select config_source as "configSource" from delivery_outbox where target_key = 'legacy:central-pushover'
    `)
    expect(targets.rows).toHaveLength(1)
    expect(targets.rows[0]?.configSource).toBe('LEGACY_ENV')
    expect(await scalar(sql`select count(*)::int as count from delivery_outbox`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from support_settings where key = 'legacy_pushover_bridge_retired_at'`)).toBe(1)
  })

  it('does not mistake an unrelated advisory waiter for cutover contention', async () => {
    const holder = await getDbPool().connect()
    const waiter = await getDbPool().connect()
    let waiting: Promise<unknown> | undefined
    try {
      await holder.query('begin')
      await holder.query('select pg_advisory_xact_lock(987654321)')
      waiting = waiter.query('select pg_advisory_xact_lock(987654321)')
      await waitForAnyAdvisoryWaiter()

      await expect(waitForRoutingLockWaiter({ attempts: 1 })).rejects.toThrow('Expected a transaction waiting on the routing advisory lock')
    } finally {
      await holder.query('rollback')
      await waiting?.catch(() => undefined)
      holder.release()
      waiter.release()
    }
  })
})

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(query)
  return rows.rows[0]?.count ?? 0
}

async function auditRows(): Promise<unknown[]> {
  const rows = await getDb().execute(sql`select action, metadata from audit_events where actor_id = ${actorId} order by id`)
  return rows.rows
}

type RoutingLockPair = { holderPid: number; waiterPid: number }

async function waitForRoutingLockWaiter({ attempts = 100, holderPid }: { attempts?: number; holderPid?: number } = {}): Promise<RoutingLockPair> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pairs = await getDb().execute<RoutingLockPair>(sql`
      with expected_lock as (
        select oid as database_oid,
          ((hashtext(${ROUTING_CUTOVER_ADVISORY_LOCK})::bigint >> 32) & 4294967295)::oid as classid,
          (hashtext(${ROUTING_CUTOVER_ADVISORY_LOCK})::bigint & 4294967295)::oid as objid
          from pg_database where datname = current_database()
      )
      select holder.pid as "holderPid", waiter.pid as "waiterPid"
        from expected_lock
        join pg_locks holder on holder.locktype = 'advisory'
          and holder.database = expected_lock.database_oid
          and holder.classid = expected_lock.classid
          and holder.objid = expected_lock.objid
          and holder.objsubid = 1
          and holder.granted
        join pg_locks waiter on waiter.locktype = holder.locktype
          and waiter.database = holder.database
          and waiter.classid = holder.classid
          and waiter.objid = holder.objid
          and waiter.objsubid = holder.objsubid
          and not waiter.granted
    `)
    const pair = pairs.rows.find((row) => holderPid === undefined || row.holderPid === holderPid)
    if (pair) return pair
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Expected a transaction waiting on the routing advisory lock')
}

async function backendPid(tx: DbTransaction): Promise<number> {
  const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid()::int as pid`)
  return result.rows[0]!.pid
}

async function waitForAnyAdvisoryWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await scalar(sql`select count(*)::int as count from pg_locks where locktype = 'advisory' and granted = false`) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Expected an unrelated advisory waiter')
}
