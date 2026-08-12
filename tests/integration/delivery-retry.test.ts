import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { retryFailedDelivery } from '@/lib/delivery/repository'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:00.000Z')

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups cascade`)
  await seedGraph()
})

afterAll(async () => { await closeDbPool() })

describe('retryFailedDelivery', () => {
  it('creates one immutable next generation when the failed delivery is retried concurrently', async () => {
    await seedOutbox('failed-delivery', 'FAILED', 4)
    const [first, second] = await Promise.all([
      retryFailedDelivery({ db: getDb(), id: 'failed-delivery', ...audit('first') }),
      retryFailedDelivery({ db: getDb(), id: 'failed-delivery', ...audit('second') }),
    ])

    expect([first.outcome, second.outcome].sort()).toEqual(['created', 'duplicate'])
    expect(first.delivery).toMatchObject({ generation: 5, status: 'PENDING' })
    expect(second.delivery).toEqual(first.delivery)
    expect(await outboxRows()).toEqual([
      { id: 'failed-delivery', generation: 4, status: 'FAILED', attemptCount: 3 },
      { id: first.delivery.id, generation: 5, status: 'PENDING', attemptCount: 0 },
    ])
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'DELIVERY_REQUEUED' and subject_id = ${first.delivery.id}`)).toBe(1)
  })

  it('returns the existing pending generation without duplicating audit evidence', async () => {
    await seedOutbox('failed-delivery', 'FAILED', 2)
    await seedOutbox('pending-delivery', 'PENDING', 3)

    await expect(retryFailedDelivery({ db: getDb(), id: 'failed-delivery', ...audit('pending') })).resolves.toEqual({
      outcome: 'duplicate', delivery: { id: 'pending-delivery', generation: 3, status: 'PENDING' },
    })
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'DELIVERY_REQUEUED' and subject_id = 'pending-delivery'`)).toBe(0)
  })

  it('rejects a stale next generation without claiming it is pending', async () => {
    await seedOutbox('failed-delivery', 'FAILED', 2)
    await seedOutbox('sent-delivery', 'SENT', 3)

    await expect(retryFailedDelivery({ db: getDb(), id: 'failed-delivery', ...audit('stale') })).rejects.toThrow('Delivery retry is no longer pending')
    expect(await outboxRows()).toEqual([
      { id: 'failed-delivery', generation: 2, status: 'FAILED', attemptCount: 3 },
      { id: 'sent-delivery', generation: 3, status: 'SENT', attemptCount: 3 },
    ])
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'DELIVERY_REQUEUED' and subject_id = 'sent-delivery'`)).toBe(0)
  })

  it.each(['PENDING', 'LEASED', 'RETRYING', 'SENT', 'CANCELLED'] as const)('rejects a %s delivery without mutation or audit evidence', async (status) => {
    await seedOutbox(`${status.toLowerCase()}-delivery`, status, 2)

    await expect(retryFailedDelivery({ db: getDb(), id: `${status.toLowerCase()}-delivery`, ...audit(status) })).rejects.toThrow('Only failed deliveries can be retried')

    expect(await outboxRows()).toEqual([
      { id: `${status.toLowerCase()}-delivery`, generation: 2, status, attemptCount: 3 },
    ])
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'DELIVERY_REQUEUED' and subject_id = ${`${status.toLowerCase()}-delivery`}`)).toBe(0)
  })
})

function audit(label: string) {
  return { actorId: 'admin-1', correlationId: `delivery-retry-${label}-${randomUUID()}`, reason: 'Retried failed delivery', now }
}

async function seedGraph() {
  await getDb().execute(sql`
    insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('retry-group', 'Retry group', 'ACTIVE', false, ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values ('retry-app', 'retry-app', 'Retry app', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into feedback_tickets (id, source_app_id, external_id, kind, status, priority, title, description, raw_payload, last_synced_at, created_at, updated_at)
      values ('retry-ticket', 'retry-app', 'retry-external', 'BUG', 'NEW', 'HIGH', 'Retry', 'Retry', '{}'::jsonb, ${now}, ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
      values ('retry-event', 'retry-ticket', 1, 'retry-event', '{}'::jsonb, ${now})
  `)
}

async function seedOutbox(id: string, status: 'PENDING' | 'LEASED' | 'RETRYING' | 'FAILED' | 'SENT' | 'CANCELLED', generation: number) {
  await getDb().execute(sql`
    insert into delivery_outbox (
      id, escalation_event_id, event_key, target_key, generation, channel_type, config_source,
      rendered_payload, status, next_attempt_at, attempt_count, sent_at, created_at, updated_at
    ) values (
      ${id}, 'retry-event', 'retry-event', 'legacy:central-pushover', ${generation}, 'PUSHOVER', 'LEGACY_ENV',
      '{}'::jsonb, ${status}::"DeliveryStatus", ${now}, 3, ${status === 'SENT' ? now : null}, ${now}, ${now}
    )
  `)
}

async function outboxRows(): Promise<Array<{ id: string; generation: number; status: string; attemptCount: number }>> {
  const result = await getDb().execute<{ id: string; generation: number; status: string; attemptCount: number }>(sql`
    select id, generation, status::text as status, attempt_count as "attemptCount"
      from delivery_outbox order by generation
  `)
  return result.rows
}

async function scalar(query: SQL): Promise<number> {
  const result = await getDb().execute<{ count: number }>(query)
  return result.rows[0]?.count ?? 0
}
