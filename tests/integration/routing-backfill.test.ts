import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { backfillSupportRouting } from '@/scripts/backfill-support-routing'
import { acceptLegacyPayload } from '@/lib/escalations/legacy'
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

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_settings, audit_events cascade`)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
    values ('backfill-app-a', 'backfill-a', 'Backfill A', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', now(), now()),
           ('backfill-app-b', 'backfill-b', 'Backfill B', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', now(), now())
  `)
})

afterAll(async () => { await closeDbPool() })

describe('backfillSupportRouting', () => {
  it('creates the central encrypted Pushover route and app policies once', async () => {
    const first = await backfillSupportRouting({ db: getDb(), env: fullEnv, actorId: 'migration-actor' })
    const second = await backfillSupportRouting({ db: getDb(), env: fullEnv, actorId: 'migration-actor' })

    expect(first).toEqual({ centralGroupsCreated: 1, channelsCreated: 1, policiesCreated: 2, appsChanged: 2, bridgeRetired: true })
    expect(second).toEqual({ centralGroupsCreated: 0, channelsCreated: 0, policiesCreated: 0, appsChanged: 0, bridgeRetired: false })
    expect(await scalar(sql`select count(*)::int as count from support_groups where is_central_fallback`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from notification_channels where name = 'Central Pushover'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from app_notification_policies`)).toBe(2)
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'SUPPORT_ROUTING_BACKFILLED'`)).toBe(2)
    expect(await scalar(sql`select count(*)::int as count from source_apps where technical_group_id is null or credential_mode <> 'LEGACY_BEARER'`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from support_settings where key = 'legacy_pushover_bridge_retired_at'`)).toBe(1)
    expect(JSON.stringify(await auditRows())).not.toContain('backfill-app-token')
    expect(JSON.stringify(await auditRows())).not.toContain('backfill-user-key')
  })

  it('does not create a channel or retire the bridge with only one Pushover value', async () => {
    const result = await backfillSupportRouting({
      db: getDb(), env: { PUSHOVER_APP_TOKEN: 'present', SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON: encryptionKeys }, actorId: 'migration-actor',
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
    const backfill = backfillSupportRouting({
      db: getDb(), env: fullEnv, actorId: 'migration-actor',
      onRoutingLock: async () => { cutoverLocked(); await release },
    })
    await locked
    const intake = acceptLegacyPayload({
      db: getDb(), env: fullEnv, authoritativeAppSlug: 'backfill-a', idempotencyKey: `race-${randomUUID()}`,
      payload: { app: { slug: 'backfill-a', name: 'Backfill A', environment: 'test' }, ticket: { externalId: 'race-1', kind: 'BUG', status: 'NEW', priority: 'MEDIUM', title: 'Race', description: 'Race' } },
    })
    releaseCutover()
    await Promise.all([backfill, intake])

    const targets = await getDb().execute<{ eventId: string; targetKey: string; configSource: string }>(sql`
      select escalation_event_id as "eventId", target_key as "targetKey", config_source as "configSource"
        from delivery_outbox order by escalation_event_id, target_key
    `)
    expect(targets.rows).toHaveLength(1)
    expect(targets.rows[0]).toMatchObject({ configSource: 'DATABASE' })
    expect(targets.rows[0]?.targetKey).toMatch(/^channel:/)
    expect(await scalar(sql`select count(*)::int as count from delivery_outbox group by escalation_event_id having count(*) <> 1`)).toBe(0)
  })
})

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(query)
  return rows.rows[0]?.count ?? 0
}

async function auditRows(): Promise<unknown[]> {
  const rows = await getDb().execute(sql`select action, metadata from audit_events order by id`)
  return rows.rows
}
