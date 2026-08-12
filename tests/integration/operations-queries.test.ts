import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { getDeliveryOperations } from '@/lib/delivery/queries'
import { getAuditHistory } from '@/lib/audit/queries'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
const now = new Date('2026-08-12T15:00:00.000Z')
const auditRun = randomUUID()

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_users cascade`)
  await seedBase()
})
afterAll(async () => { await closeDbPool() })

describe('operations read models', () => {
  it('orders retries by next attempt, failed deliveries newest first, and preserves sanitized routing context', async () => {
    await seedDelivery({ id: 'retry-later', status: 'RETRYING', nextAttemptAt: new Date('2026-08-12T16:00:00.000Z'), createdAt: now })
    await seedDelivery({ id: 'retry-first', status: 'RETRYING', nextAttemptAt: new Date('2026-08-12T15:05:00.000Z'), createdAt: now })
    await seedDelivery({ id: 'failed-old', status: 'FAILED', nextAttemptAt: now, createdAt: new Date('2026-08-12T13:00:00.000Z'), sanitizedError: 'The provider rejected this destination.' })
    await seedDelivery({ id: 'failed-new', status: 'FAILED', nextAttemptAt: now, createdAt: new Date('2026-08-12T14:00:00.000Z'), sanitizedError: 'The target no longer accepts messages.', routingIncident: 'No active central fallback is available.' })

    const retrying = await getDeliveryOperations({ db: getDb(), view: 'retrying', limit: 50 })
    expect(retrying.rows.map((row) => row.id)).toEqual(['retry-first', 'retry-later'])

    const failed = await getDeliveryOperations({ db: getDb(), view: 'failed', limit: 50 })
    expect(failed.rows.map((row) => row.id)).toEqual(['failed-new', 'failed-old'])
    expect(failed.rows[0]).toMatchObject({
      destination: 'r***@ops.example.test',
      sanitizedCause: 'The target no longer accepts messages.',
      routingIncident: 'No active central fallback is available.',
      retryAvailable: true,
    })
    expect(failed.summary).toMatchObject({ deadLetters: 2, routingIncidents: 1 })
  })

  it('uses stable keyset pages for delivery history and the security audit when timestamps tie', async () => {
    const auditNow = await nextAuditTimestamp()
    for (let index = 0; index < 55; index += 1) {
      await seedDelivery({ id: `sent-${String(index).padStart(2, '0')}`, status: 'SENT', nextAttemptAt: now, createdAt: now, useChannel: false })
      await seedAudit(`audit-${auditRun}-${String(index).padStart(2, '0')}`, auditNow)
    }

    const firstHistory = await getDeliveryOperations({ db: getDb(), view: 'history', limit: 50 })
    const secondHistory = await getDeliveryOperations({ db: getDb(), view: 'history', limit: 50, cursor: firstHistory.nextCursor! })
    expect(firstHistory.rows).toHaveLength(50)
    expect(secondHistory.rows).toHaveLength(5)
    expect(new Set([...firstHistory.rows, ...secondHistory.rows].map((row) => row.id)).size).toBe(55)

    const firstAudit = await getAuditHistory({ db: getDb(), limit: 50 })
    const secondAudit = await getAuditHistory({ db: getDb(), limit: 50, cursor: firstAudit.nextCursor! })
    expect(firstAudit.rows).toHaveLength(50)
    const auditRows = [...firstAudit.rows, ...secondAudit.rows]
      .filter((row) => row.id.startsWith(`audit-${auditRun}-`))
    expect(auditRows).toHaveLength(55)
    expect(new Set(auditRows.map((row) => row.id)).size).toBe(55)
  })

  it('uses only the latest escalation event and latest target generation for live delivery state', async () => {
    await seedTicket('ticket-current')
    await seedEventDelivery({
      ticketId: 'ticket-current', eventId: 'event-current-1', eventKey: 'current-1', eventGeneration: 1,
      id: 'failed-stale', targetKey: 'channel:channel-release', generation: 1, status: 'FAILED', createdAt: new Date('2026-08-12T13:00:00.000Z'),
    })
    await seedEventDelivery({
      ticketId: 'ticket-current', eventId: 'event-current-2', eventKey: 'current-2', eventGeneration: 2,
      id: 'retry-stale-generation', targetKey: 'channel:channel-release', generation: 1, status: 'RETRYING', createdAt: new Date('2026-08-12T14:01:00.000Z'),
    })
    await seedOutbox({ id: 'sent-secondary-current', eventId: 'event-current-2', eventKey: 'current-2', targetKey: 'channel:channel-release', generation: 2, status: 'SENT', createdAt: new Date('2026-08-12T14:02:00.000Z') })

    const [failed, retrying] = await Promise.all([
      getDeliveryOperations({ db: getDb(), view: 'failed', limit: 50 }),
      getDeliveryOperations({ db: getDb(), view: 'retrying', limit: 50 }),
    ])

    expect(failed.rows.map((row) => row.id)).not.toContain('failed-stale')
    expect(retrying.rows.map((row) => row.id)).not.toContain('retry-stale-generation')
    expect(failed.summary.deadLetters).toBe(0)
  })

  it('projects a current routing incident without an outbox row as an actionable failed delivery', async () => {
    await seedTicket('ticket-unroutable')
    await getDb().execute(sql`
      insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
      values ('event-unroutable', 'ticket-unroutable', 1, 'unroutable-1', '{}'::jsonb, ${now})
    `)
    await getDb().execute(sql`
      insert into routing_incidents (id, escalation_event_id, reason, details, created_at)
      values ('incident-unroutable', 'event-unroutable', 'No active central fallback is available.', '{}'::jsonb, ${now})
    `)

    const failed = await getDeliveryOperations({ db: getDb(), view: 'failed', limit: 50 })
    expect(failed.rows).toContainEqual(expect.objectContaining({
      id: 'incident:incident-unroutable', status: 'FAILED', routingIncident: 'No active central fallback is available.',
      nextAction: 'Configure an active technical route, then resend the escalation.', retryAvailable: false,
    }))
    expect(failed.summary.routingIncidents).toBe(1)
  })
})

async function seedBase(): Promise<void> {
  await getDb().execute(sql`
    insert into support_groups (id, name, created_at, updated_at)
    values ('group-platform', 'Platform reliability', ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into notification_channels
      (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version,
       recipient_display, redacted_destination, created_at, updated_at)
    values ('channel-release', 'group-platform', 'Release alerts', 'EMAIL', 'ACTIVE', 'ciphertext', 'nonce', 'tag', 1,
      'r***@ops.example.test', 'r***@ops.example.test', ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, created_at, updated_at)
    values ('app-amber', 'amber', 'Amber checkout', 'test', 'ACTIVE', ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into feedback_tickets
      (id, source_app_id, external_id, kind, status, priority, title, description, url, raw_payload, last_synced_at, created_at, updated_at)
    values ('ticket-amber', 'app-amber', 'amber-42', 'BUG', 'NEW', 'HIGH', 'Checkout errors', 'Details', 'https://amber.example.test/42', '{}'::jsonb, ${now}, ${now}, ${now})
  `)
}

async function seedDelivery(input: { id: string; status: string; nextAttemptAt: Date; createdAt: Date; sanitizedError?: string; routingIncident?: string; useChannel?: boolean }): Promise<void> {
  const eventId = `event-${input.id}`
  const ticketId = `ticket-${input.id}`
  await getDb().execute(sql`
    insert into feedback_tickets
      (id, source_app_id, external_id, kind, status, priority, title, description, url, raw_payload, last_synced_at, created_at, updated_at)
    values (${ticketId}, 'app-amber', ${`external-${input.id}`}, 'BUG', 'NEW', 'HIGH', ${`Delivery ${input.id}`}, 'Details', 'https://amber.example.test/delivery', '{}'::jsonb, ${input.createdAt}, ${input.createdAt}, ${input.createdAt})
  `)
  await getDb().execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
    values (${eventId}, ${ticketId}, 1, ${`key-${input.id}`}, '{}'::jsonb, ${input.createdAt})
  `)
  await getDb().execute(sql`
    insert into delivery_outbox
      (id, escalation_event_id, event_key, target_key, generation, channel_id, channel_type, config_source,
       rendered_payload, status, next_attempt_at, attempt_count, sent_at, created_at, updated_at)
    values (${input.id}, ${eventId}, ${`key-${input.id}`}, ${input.useChannel === false ? 'legacy:central-pushover' : 'channel:channel-release'}, 1, ${input.useChannel === false ? null : 'channel-release'}, ${input.useChannel === false ? 'PUSHOVER' : 'EMAIL'}, ${input.useChannel === false ? 'LEGACY_ENV' : 'DATABASE'},
      '{}'::jsonb, ${input.status}::"DeliveryStatus", ${input.nextAttemptAt}, 3,
      ${input.status === 'SENT' ? input.createdAt : null}, ${input.createdAt}, ${input.createdAt})
  `)
  if (input.sanitizedError) {
    await getDb().execute(sql`
      insert into delivery_attempts (id, outbox_id, ordinal, target_key, started_at, finished_at, result_class, sanitized_error, created_at)
      values (${`attempt-${input.id}`}, ${input.id}, 3, ${input.useChannel === false ? 'legacy:central-pushover' : 'channel:channel-release'}, ${input.createdAt}, ${input.createdAt}, 'PERMANENT', ${input.sanitizedError}, ${input.createdAt})
    `)
  }
  if (input.routingIncident) {
    await getDb().execute(sql`
      insert into routing_incidents (id, escalation_event_id, reason, details, created_at)
      values (${`incident-${input.id}`}, ${eventId}, ${input.routingIncident}, '{}'::jsonb, ${input.createdAt})
    `)
  }
}

async function seedTicket(id: string): Promise<void> {
  await getDb().execute(sql`
    insert into feedback_tickets
      (id, source_app_id, external_id, kind, status, priority, title, description, url, raw_payload, last_synced_at, created_at, updated_at)
    values (${id}, 'app-amber', ${`external-${id}`}, 'BUG', 'NEW', 'HIGH', ${`Delivery ${id}`}, 'Details', 'https://amber.example.test/delivery', '{}'::jsonb, ${now}, ${now}, ${now})
  `)
}

async function seedEventDelivery(input: { ticketId: string; eventId: string; eventKey: string; eventGeneration: number; id: string; targetKey: string; generation: number; status: string; createdAt: Date }): Promise<void> {
  await getDb().execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
    values (${input.eventId}, ${input.ticketId}, ${input.eventGeneration}, ${input.eventKey}, '{}'::jsonb, ${input.createdAt})
    on conflict (id) do nothing
  `)
  await seedOutbox(input)
}

async function seedOutbox(input: { id: string; eventId: string; eventKey: string; targetKey: string; generation: number; status: string; createdAt: Date }): Promise<void> {
  await getDb().execute(sql`
    insert into delivery_outbox
      (id, escalation_event_id, event_key, target_key, generation, channel_id, channel_type, config_source,
       rendered_payload, status, next_attempt_at, attempt_count, sent_at, created_at, updated_at)
    values (${input.id}, ${input.eventId}, ${input.eventKey}, ${input.targetKey}, ${input.generation}, 'channel-release', 'EMAIL', 'DATABASE',
      '{}'::jsonb, ${input.status}::"DeliveryStatus", ${input.createdAt}, 3,
      ${input.status === 'SENT' ? input.createdAt : null}, ${input.createdAt}, ${input.createdAt})
  `)
}

async function seedAudit(id: string, createdAt: Date): Promise<void> {
  await getDb().execute(sql`
    insert into audit_events (id, actor_type, actor_id, action, subject_type, subject_id, metadata, request_correlation_id, created_at)
    values (${id}, 'USER', 'admin-amber', 'CHANNEL_UPDATED', 'notification_channel', 'channel-release', '{"reason":"Updated channel health"}'::jsonb, ${`corr-${id}`}, ${createdAt})
  `)
}

async function nextAuditTimestamp(): Promise<Date> {
  const result = await getDb().execute<{ latest: Date | string | null } & Record<string, unknown>>(sql`
    select max(created_at) as latest from audit_events
  `)
  const latest = result.rows[0]?.latest
  const baseline = latest ? new Date(latest) : new Date('2026-08-12T15:00:00.000Z')
  return new Date(baseline.getTime() + 60_000)
}
