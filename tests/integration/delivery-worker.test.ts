import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { runDeliverySweep } from '@/lib/delivery/worker'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:00.000Z')
const event = {
  ticketId: 'worker-ticket', appName: 'Worker App', kind: 'BUG' as const,
  priority: 'HIGH' as const, title: 'Worker failure', portalUrl: 'https://support.example.test/feedback/worker-ticket',
}

beforeEach(async () => {
  await getDb().execute(sql`truncate table delivery_attempts, delivery_outbox, escalation_events, feedback_tickets, source_apps, support_groups cascade`)
  await seedGraph()
})

afterAll(async () => {
  await closeDbPool()
})

describe('runDeliverySweep', () => {
  it('uses SKIP LOCKED so two workers begin each legacy job once', async () => {
    await seedOutbox('job-a')
    await seedOutbox('job-b')
    const send = async (): Promise<DeliveryAdapterResult> => ({ result: 'sent', providerStatus: 202, providerMessageId: 'provider-id', retryAfterMs: null, sanitizedError: null })

    const [first, second] = await Promise.all([
      runDeliverySweep({ db: getDb(), limit: 2, now, workerId: 'worker-a', legacyConfig: legacyConfig(), send }),
      runDeliverySweep({ db: getDb(), limit: 2, now, workerId: 'worker-b', legacyConfig: legacyConfig(), send }),
    ])

    expect(first.started + second.started).toBe(2)
    expect(await outboxStatuses()).toEqual(['SENT', 'SENT'])
    expect(await scalar(sql`select count(*)::int as count from delivery_attempts`)).toBe(2)
  })

  it('records retryable failures with deterministic bounded jitter', async () => {
    await seedOutbox('job-retry')

    await runDeliverySweep({
      db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(),
      send: async () => ({ result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: 'NETWORK_ERROR' }),
    })

    const row = await outbox('job-retry')
    expect(row.status).toBe('RETRYING')
    expect(row.attemptCount).toBe(1)
    expect(asDate(row.nextAttemptAt).getTime()).toBeGreaterThanOrEqual(now.getTime() + 54_000)
    expect(asDate(row.nextAttemptAt).getTime()).toBeLessThanOrEqual(now.getTime() + 66_000)
    expect(await attempt('job-retry')).toMatchObject({ resultClass: 'retryable', sanitizedError: 'NETWORK_ERROR' })
  })

  it('honors a retryable 429 Retry-After while bounding it to one hour', async () => {
    await seedOutbox('job-rate-limit')

    await runDeliverySweep({
      db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(),
      send: async () => ({ result: 'retryable', providerStatus: 429, providerMessageId: null, retryAfterMs: 2 * 60 * 60_000, sanitizedError: 'HTTP_429' }),
    })

    expect(asDate((await outbox('job-rate-limit')).nextAttemptAt)).toEqual(new Date(now.getTime() + 60 * 60_000))
  })

  it('records permanent responses as failed and records provider metadata for sent jobs', async () => {
    await seedOutbox('job-failed')
    await seedOutbox('job-sent')
    const outcomes: Record<string, DeliveryAdapterResult> = {
      'event-job-failed': { result: 'permanent', providerStatus: 400, providerMessageId: null, retryAfterMs: null, sanitizedError: 'HTTP_400' },
      'event-job-sent': { result: 'sent', providerStatus: 202, providerMessageId: 'provider-message', retryAfterMs: null, sanitizedError: null },
    }

    await runDeliverySweep({ db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(), send: async ({ idempotencyKey }) => outcomes[idempotencyKey]! })

    expect((await outbox('job-failed')).status).toBe('FAILED')
    expect(await attempt('job-failed')).toMatchObject({ resultClass: 'permanent', providerStatus: '400', sanitizedError: 'HTTP_400' })
    expect((await outbox('job-sent')).status).toBe('SENT')
    expect(await attempt('job-sent')).toMatchObject({ resultClass: 'sent', providerStatus: '202', providerMessageId: 'provider-message' })
  })

  it('recovers an expired legacy lease', async () => {
    await seedOutbox('job-expired', { status: 'LEASED', leaseExpiresAt: new Date(now.getTime() - 1_000) })

    await runDeliverySweep({ db: getDb(), now, workerId: 'recovery-worker', legacyConfig: legacyConfig(), send: async () => ({ result: 'sent', providerStatus: 200, providerMessageId: null, retryAfterMs: null, sanitizedError: null }) })

    expect((await outbox('job-expired')).status).toBe('SENT')
  })

  it('leaves DATABASE jobs pending with a visible configuration-not-ready attempt', async () => {
    await seedOutbox('job-database', { configSource: 'DATABASE', targetKey: 'channel:worker-channel', channelId: 'worker-channel' })

    const result = await runDeliverySweep({ db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(), send: async () => { throw new Error('DATABASE must not dispatch') } })

    expect(result.configurationNotReady).toBe(1)
    expect((await outbox('job-database')).status).toBe('PENDING')
    expect(await attempt('job-database')).toMatchObject({ resultClass: 'CONFIGURATION_NOT_READY' })
  })
})

function legacyConfig() {
  return { type: 'PUSHOVER' as const, appToken: 'test-app-token', userKey: 'test-user-key' }
}

async function seedGraph(): Promise<void> {
  const db = getDb()
  await db.execute(sql`
    insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('worker-group', 'Worker group', 'ACTIVE', false, ${now}, ${now})
  `)
  await db.execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values ('worker-app', 'worker-app', 'Worker App', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', ${now}, ${now})
  `)
  await db.execute(sql`
    insert into feedback_tickets (id, source_app_id, external_id, kind, status, priority, title, description, raw_payload, last_synced_at, created_at, updated_at)
      values ('worker-ticket', 'worker-app', 'worker-external', 'BUG', 'NEW', 'HIGH', 'Worker failure', 'private', '{}'::jsonb, ${now}, ${now}, ${now})
  `)
  await db.execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
      values ('worker-event', 'worker-ticket', 1, 'worker-event', '{}'::jsonb, ${now})
  `)
  await db.execute(sql`
    insert into notification_channels (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at)
      values ('worker-channel', 'worker-group', 'Worker channel', 'PUSHOVER', 'ACTIVE', 'cipher', 'nonce', 'tag', 1, ${now}, ${now})
  `)
}

async function seedOutbox(id: string, options: {
  status?: 'PENDING' | 'LEASED'
  leaseExpiresAt?: Date
  configSource?: 'DATABASE' | 'LEGACY_ENV'
  targetKey?: string
  channelId?: string | null
} = {}): Promise<void> {
  const configSource = options.configSource ?? 'LEGACY_ENV'
  const targetKey = options.targetKey ?? 'legacy:central-pushover'
  const channelId = options.channelId ?? null
  await getDb().execute(sql`
    insert into delivery_outbox (
      id, escalation_event_id, event_key, target_key, generation, channel_id, channel_type, config_source,
      rendered_payload, status, next_attempt_at, attempt_count, lease_token, lease_expires_at, created_at, updated_at
    ) values (
      ${id}, 'worker-event', ${`event-${id}`}, ${targetKey}, 1, ${channelId}, 'PUSHOVER', ${configSource},
      ${JSON.stringify(event)}::jsonb, ${options.status ?? 'PENDING'}::"DeliveryStatus", ${now}, 0,
      ${options.status === 'LEASED' ? 'stale-worker' : null}, ${options.leaseExpiresAt ?? null}, ${now}, ${now}
    )
  `)
}

async function outbox(id: string): Promise<{ status: string; attemptCount: number; nextAttemptAt: Date }> {
  const result = await getDb().execute<{ status: string; attemptCount: number; nextAttemptAt: Date }>(sql`
    select status::text as status, attempt_count as "attemptCount", next_attempt_at as "nextAttemptAt"
      from delivery_outbox where id = ${id}
  `)
  return result.rows[0]!
}

async function attempt(id: string): Promise<Record<string, unknown>> {
  const result = await getDb().execute<Record<string, unknown>>(sql`
    select result_class as "resultClass", provider_status as "providerStatus", provider_message_id as "providerMessageId", sanitized_error as "sanitizedError"
      from delivery_attempts where outbox_id = ${id}
  `)
  return result.rows[0]!
}

async function outboxStatuses(): Promise<string[]> {
  const result = await getDb().execute<{ status: string }>(sql`select status::text as status from delivery_outbox order by id`)
  return result.rows.map((row) => row.status)
}

async function scalar(query: SQL): Promise<number> {
  const result = await getDb().execute<{ count: number }>(query)
  return result.rows[0]?.count ?? 0
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
