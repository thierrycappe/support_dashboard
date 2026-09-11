import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair } from 'jose'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { registerApplication } from '@/lib/apps/registration'
import { publicJwkThumbprint, type Ed25519PublicJwk } from '@/lib/service-auth/jwk'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
const now = new Date('2026-09-11T12:00:00.000Z')
const input = {
  name: 'Beacon', slug: 'beacon', baseUrl: 'https://beacon.example.test', environment: 'production' as const,
  ownerIds: ['owner-1'], vercelProjectId: 'project-1', vercelTeamId: 'team-1',
}
let publicKey: Ed25519PublicJwk

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_users, audit_events cascade`)
  await getDb().execute(sql`
    insert into support_users (id,email,name,role,status,password_hash,created_at,updated_at)
    values ('admin-1','admin@example.test','Admin','ADMIN','ACTIVE','hash',${now},${now}),
           ('owner-1','owner@example.test','Owner','SUPPORT','ACTIVE','hash',${now},${now})
  `)
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  publicKey = await exportJWK(pair.publicKey) as Ed25519PublicJwk
})
afterAll(async () => { await closeDbPool() })

describe('trusted application registration', () => {
  it('creates active app identity, ownership, default policy, and safe audit atomically', async () => {
    const result = await registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'registration-test', input: { ...input, publicKey }, now })
    expect(result).toMatchObject({ created: true, keyId: publicJwkThumbprint(publicKey) })
    expect(await scalar(sql`select count(*)::int as count from source_apps where id=${result.appId} and enrollment_status='ACTIVE' and credential_mode='PUBLIC_KEY'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from app_credentials where id=${result.credentialId} and status='ACTIVE'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from support_group_members where support_user_id='owner-1' and group_id=(select technical_group_id from source_apps where id=${result.appId})`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from app_notification_policies where source_app_id=${result.appId} and minimum_priority='MEDIUM' and urgent_central_copy and fallback_to_central`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from audit_events where action='APP_REGISTRATION_CREATED' and subject_id=${result.appId}`)).toBe(1)
  })

  it('returns the original identity on a retry and rejects a different slug for the binding', async () => {
    const first = await registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'first', input: { ...input, publicKey }, now })
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'retry', input: { ...input, name: 'Changed', baseUrl: 'https://changed.example.test', ownerIds: ['admin-1'], publicKey }, now })).resolves.toEqual(first && { ...first, created: false })
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'conflict', input: { ...input, slug: 'another-slug', publicKey }, now })).rejects.toMatchObject({ code: 'BINDING_CONFLICT' })
  })

  it('serializes concurrent retries to one committed identity', async () => {
    const results = await Promise.all([
      registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'concurrent-a', input: { ...input, publicKey }, now }),
      registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'concurrent-b', input: { ...input, publicKey }, now }),
    ])
    expect(results.map((result) => result.appId)).toEqual([results[0]!.appId, results[0]!.appId])
    expect(results.map((result) => result.created).sort()).toEqual([false, true])
    expect(await scalar(sql`select count(*)::int as count from source_apps where slug=${input.slug}`)).toBe(1)
  })

  it('turns a duplicate key on another binding into KEY_CONFLICT and rolls back the attempted graph', async () => {
    const first = await registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'first', input: { ...input, publicKey }, now })
    const before = await graphCounts()
    await expect(registerApplication({
      db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'duplicate-key',
      input: { ...input, slug: 'different-slug', vercelProjectId: 'different-project', publicKey }, now,
    })).rejects.toMatchObject({ code: 'KEY_CONFLICT' })
    expect(await graphCounts()).toEqual(before)
    expect(first.created).toBe(true)
  })

  it('requires an active administrator and active owners inside the transaction', async () => {
    await getDb().execute(sql`update support_users set status='DISABLED' where id='admin-1'`)
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'disabled-admin', input: { ...input, publicKey }, now })).rejects.toMatchObject({ code: 'ACTOR_FORBIDDEN' })
    await getDb().execute(sql`update support_users set status='ACTIVE', role='SUPPORT' where id='admin-1'`)
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'support-actor', input: { ...input, publicKey }, now })).rejects.toMatchObject({ code: 'ACTOR_FORBIDDEN' })
    await getDb().execute(sql`update support_users set role='ADMIN', status='ACTIVE' where id='admin-1'; update support_users set status='DISABLED' where id='owner-1'`)
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'disabled-owner', input: { ...input, publicKey }, now })).rejects.toMatchObject({ code: 'OWNER_NOT_FOUND' })
    expect(await scalar(sql`select count(*)::int as count from source_apps`)).toBe(0)
  })

  it('does not revive pending, legacy, or revoked registrations', async () => {
    const states = [
      { label: 'pending', status: 'PENDING', appStatus: 'ACTIVE', enrollmentStatus: 'ACTIVE', credentialMode: 'PUBLIC_KEY' },
      { label: 'legacy', status: 'ACTIVE', appStatus: 'ACTIVE', enrollmentStatus: 'ACTIVE', credentialMode: 'LEGACY_BEARER' },
      { label: 'revoked', status: 'REVOKED', appStatus: 'ACTIVE', enrollmentStatus: 'ACTIVE', credentialMode: 'PUBLIC_KEY' },
    ] as const
    for (const [index, state] of states.entries()) {
      const pair = await generateKeyPair('EdDSA', { extractable: true })
      const key = await exportJWK(pair.publicKey) as Ed25519PublicJwk
      const registrationInput = { ...input, slug: `${state.label}-registration`, vercelProjectId: `${state.label}-project`, publicKey: key }
      await seedRegistration(registrationInput, state, index)
      await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: state.label, input: registrationInput, now })).rejects.toMatchObject({ code: 'KEY_CONFLICT' })
    }
  })

  it('allows distinct production and preview identities for one project', async () => {
    const production = await registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'production', input: { ...input, publicKey }, now })
    const pair = await generateKeyPair('EdDSA', { extractable: true })
    const previewKey = await exportJWK(pair.publicKey) as Ed25519PublicJwk
    const preview = await registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'preview', input: { ...input, slug: 'beacon-preview', environment: 'preview', publicKey: previewKey }, now })
    expect(preview.created).toBe(true)
    expect(preview.appId).not.toBe(production.appId)
  })

  it('does not revive a revoked or disabled registration and rolls back invalid owners', async () => {
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'owners', input: { ...input, ownerIds: ['missing'], publicKey }, now })).rejects.toMatchObject({ code: 'OWNER_NOT_FOUND' })
    expect(await scalar(sql`select count(*)::int as count from source_apps`)).toBe(0)
    const first = await registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'first', input: { ...input, publicKey }, now })
    await getDb().execute(sql`update source_apps set status='PAUSED' where id=${first.appId}`)
    await expect(registerApplication({ db: getDb(), actorId: 'admin-1', configuredTeamId: 'team-1', correlationId: 'retry', input: { ...input, publicKey }, now })).rejects.toMatchObject({ code: 'KEY_CONFLICT' })
  })
})

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const result = await getDb().execute<{ count: number }>(query)
  return Number(result.rows[0]?.count ?? 0)
}

async function graphCounts(): Promise<{ apps: number; groups: number; members: number; policies: number; credentials: number; audits: number }> {
  const result = await getDb().execute<{ apps: number; groups: number; members: number; policies: number; credentials: number; audits: number }>(sql`
    select
      (select count(*) from source_apps)::int as apps,
      (select count(*) from support_groups)::int as groups,
      (select count(*) from support_group_members)::int as members,
      (select count(*) from app_notification_policies)::int as policies,
      (select count(*) from app_credentials)::int as credentials,
      (select count(*) from audit_events where action='APP_REGISTRATION_CREATED')::int as audits
  `)
  return result.rows[0]!
}

async function seedRegistration(
  registrationInput: typeof input & { publicKey: Ed25519PublicJwk },
  state: { status: string; appStatus: string; enrollmentStatus: string; credentialMode: string },
  index: number,
): Promise<void> {
  const appId = `existing-${index}`
  const groupId = `existing-group-${index}`
  await getDb().execute(sql`
    insert into support_groups (id,name,status,is_central_fallback,created_at,updated_at)
    values (${groupId}, ${`${registrationInput.slug} owners`}, 'ACTIVE', false, ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into source_apps (id,slug,name,base_url,environment,status,enrollment_status,credential_mode,technical_group_id,metadata,created_at,updated_at)
    values (${appId},${registrationInput.slug},${registrationInput.name},${registrationInput.baseUrl},${registrationInput.environment},${state.appStatus},${state.enrollmentStatus},${state.credentialMode},${groupId},${JSON.stringify({ registration: { vercelProjectId: registrationInput.vercelProjectId, vercelTeamId: registrationInput.vercelTeamId } })}::jsonb,${now},${now})
  `)
  await getDb().execute(sql`
    insert into app_credentials (id,source_app_id,public_jwk,public_key_thumbprint,status,valid_from,valid_until,revoked_at,created_at)
    values (${`existing-credential-${index}`},${appId},${JSON.stringify(registrationInput.publicKey)}::jsonb,${publicJwkThumbprint(registrationInput.publicKey)},${state.status},${now},${state.status === 'REVOKED' ? now : null},${state.status === 'REVOKED' ? now : null},${now})
  `)
}
