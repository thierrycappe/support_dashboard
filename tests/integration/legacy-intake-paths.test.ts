import { afterAll, beforeEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { acceptLegacyPayload } from '@/lib/escalations/legacy'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
process.env.SUPPORT_TOWER_PUBLIC_URL = 'https://support.example.test'
const now = new Date('2026-08-12T12:00:00.000Z')

beforeEach(async () => {
  await getDb().execute(sql`truncate table delivery_attempts, delivery_outbox, escalation_events, feedback_tickets, ingest_receipts, source_apps cascade`)
  await getDb().execute(sql`insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at) values ('legacy-app', 'casal-track', 'Casal Track', 'test', 'ACTIVE', 'ACTIVE', 'LEGACY_BEARER', ${now}, ${now})`)
})
afterAll(async () => { await closeDbPool() })

it('creates a reserved durable delivery target for a full-pull compatible payload', async () => {
  const result = await acceptLegacyPayload({
    payload: { app: { slug: 'casal-track', name: 'Untrusted display name', environment: 'test' }, ticket: { externalId: 'ct_42', kind: 'BUG', status: 'NEW', priority: 'MEDIUM', title: 'Broken', description: 'Details' } },
    authoritativeAppSlug: 'casal-track', env: { PUSHOVER_APP_TOKEN: 'token', PUSHOVER_USER_KEY: 'user' }, db: getDb(),
  })
  expect(result.result).toBe('created')
  const rows = await getDb().execute<{ targetKey: string; configSource: string }>(sql`select target_key as "targetKey", config_source as "configSource" from delivery_outbox`)
  expect(rows.rows).toEqual([{ targetKey: 'legacy:central-pushover', configSource: 'LEGACY_ENV' }])
})

it('rejects a payload whose source identity differs from the configured pull app', async () => {
  await expect(acceptLegacyPayload({
    payload: { app: { slug: 'other-app', name: 'Other', environment: 'test' }, ticket: { externalId: 'ct_42', kind: 'BUG', status: 'NEW', priority: 'MEDIUM', title: 'Broken', description: 'Details' } },
    authoritativeAppSlug: 'casal-track', db: getDb(),
  })).rejects.toThrow('source app identity mismatch')
})
