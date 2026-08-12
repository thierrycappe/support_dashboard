import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { getEscalationQueue } from '@/lib/escalations/queries'
import { getEscalationDetail } from '@/lib/escalations/detail'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
const now = new Date('2026-08-12T15:00:00.000Z')

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_settings cascade`)
  await seedApp('app-a', 'Atlas')
  await seedApp('app-b', 'Beacon')
})
afterAll(async () => { await closeDbPool() })

describe('escalation queue query', () => {
  it('composes app, priority, status and literal wildcard search while keeping global summary', async () => {
    await seedTicket({ id: 'match', appId: 'app-a', title: 'Power 100%_safe', priority: 'URGENT', status: 'NEW', createdAt: now })
    await seedTicket({ id: 'wildcard-decoy', appId: 'app-a', title: 'Power 100xxsafe', priority: 'URGENT', status: 'NEW', createdAt: now })
    await seedTicket({ id: 'other-app', appId: 'app-b', title: 'Power 100%_safe', priority: 'URGENT', status: 'NEW', createdAt: now })
    await seedTicket({ id: 'closed', appId: 'app-a', title: 'Power 100%_safe', priority: 'URGENT', status: 'CLOSED', createdAt: now })
    await seedDelivery('match', 'RETRYING')

    const result = await getEscalationQueue({ db: getDb(), search: '100%_safe', appId: 'app-a', priority: 'URGENT', status: 'NEW', limit: 50, now })
    expect(result.rows.map(({ id }) => id)).toEqual(['match'])
    expect(result.rows[0]).toMatchObject({ appName: 'Atlas', deliveryStatus: 'RETRYING', ownerApproval: 'Approved by Source owner' })
    expect(result.summary).toEqual({ open: 3, urgent: 3, newToday: 4, retrying: 1 })
  })

  it('uses stable 50+1 keyset pages without overlap when timestamps tie or a newer row arrives', async () => {
    for (let index = 0; index < 55; index += 1) {
      await seedTicket({ id: `ticket-${String(index).padStart(2, '0')}`, appId: 'app-a', title: `Tie ${index}`, priority: 'MEDIUM', status: 'NEW', createdAt: now })
    }
    const first = await getEscalationQueue({ db: getDb(), limit: 50, now })
    expect(first.rows).toHaveLength(50)
    expect(first.nextCursor).not.toBeNull()
    await seedTicket({ id: 'newer-concurrent', appId: 'app-a', title: 'New arrival', priority: 'MEDIUM', status: 'NEW', createdAt: new Date(now.getTime() + 1_000) })
    const second = await getEscalationQueue({ db: getDb(), limit: 50, cursor: first.nextCursor!, now })
    expect(second.rows).toHaveLength(5)
    expect(new Set([...first.rows, ...second.rows].map(({ id }) => id)).size).toBe(55)
    expect(second.rows.map(({ id }) => id)).not.toContain('newer-concurrent')
    expect(second.nextCursor).toBeNull()
  })

  it('refuses a caller-controlled page size instead of changing the 50+1 query contract', async () => {
    await expect(getEscalationQueue({ db: getDb(), limit: 10 as 50, now }))
      .rejects.toThrow('Escalation queue page size must be 50')
  })

  it('includes only canonically approved feedback and counts its escalation day', async () => {
    await seedTicket({ id: 'approved-today', appId: 'app-a', title: 'Approved today', priority: 'URGENT', status: 'NEW', createdAt: new Date('2026-08-10T10:00:00.000Z'), escalatedAt: '2026-08-12T08:00:00.000Z' })
    await seedTicket({ id: 'approved-yesterday', appId: 'app-a', title: 'Approved yesterday', priority: 'MEDIUM', status: 'NEW', createdAt: now, escalatedAt: '2026-08-11T23:59:59.000Z' })
    await seedTicket({ id: 'missing-triage', appId: 'app-a', title: 'Missing triage', priority: 'URGENT', status: 'NEW', createdAt: now, triage: null })
    await seedTicket({ id: 'malformed-triage', appId: 'app-a', title: 'Malformed triage', priority: 'URGENT', status: 'NEW', createdAt: now, triage: '{"ownerRef":"owner","ownerName":null,"escalatedAt":"not-a-date"}' })
    await seedTicket({ id: 'incomplete-triage', appId: 'app-a', title: 'Incomplete triage', priority: 'URGENT', status: 'NEW', createdAt: now, triage: '{"ownerName":"Source owner","escalatedAt":"2026-08-12T12:00:00.000Z"}' })
    await seedDelivery('missing-triage', 'RETRYING')

    const result = await getEscalationQueue({ db: getDb(), limit: 50, now })

    expect(result.rows.map(({ id }) => id)).toEqual(['approved-yesterday', 'approved-today'])
    expect(result.summary).toEqual({ open: 2, urgent: 1, newToday: 1, retrying: 0 })
  })

  it('aggregates delivery state from the newest generation for every target', async () => {
    await seedTicket({ id: 'delivery-ticket', appId: 'app-a', title: 'Delivery generations', priority: 'HIGH', status: 'NEW', createdAt: now })
    await seedChannel('channel-alpha')
    await seedChannel('channel-bravo')
    await seedDelivery('delivery-ticket', 'FAILED', 1, 'channel:channel-alpha', 'channel-alpha', 3)
    await seedDelivery('delivery-ticket', 'PENDING', 2, 'channel:channel-alpha', 'channel-alpha', 1)
    await seedDelivery('delivery-ticket', 'SENT', 2, 'channel:channel-bravo', 'channel-bravo', 1)

    const result = await getEscalationQueue({ db: getDb(), limit: 50, now })

    expect(result.rows).toEqual([expect.objectContaining({ id: 'delivery-ticket', deliveryStatus: 'PENDING' })])
  })

  it('loads canonical approval, hardened source context, and delivery attempts in chronological order', async () => {
    await seedTicket({ id: 'detail-ticket', appId: 'app-a', title: 'Detail delivery history', priority: 'HIGH', status: 'NEW', createdAt: new Date('2026-08-09T08:00:00.000Z') })
    await seedDelivery('detail-ticket', 'RETRYING')
    await seedDeliveryAttempt('detail-ticket', 2, new Date('2026-08-12T09:05:00.000Z'), 'sent', null)
    await seedDeliveryAttempt('detail-ticket', 1, new Date('2026-08-12T09:00:00.000Z'), 'retryable', 'Provider was temporarily unavailable.')

    const detail = await getEscalationDetail('detail-ticket', getDb(), now)

    expect(detail).toMatchObject({
      ticket: { id: 'detail-ticket', title: 'Detail delivery history' },
      application: { name: 'Atlas', sourceUrl: 'https://source.example/detail-ticket' },
      approval: { ownerName: 'Source owner', ownerRef: 'owner' },
      stale: true,
    })
    expect(detail?.deliveryAttempts.map(({ ordinal, resultClass }) => ({ ordinal, resultClass }))).toEqual([
      { ordinal: 1, resultClass: 'retryable' },
      { ordinal: 2, resultClass: 'sent' },
    ])
  })
})

async function seedApp(id: string, name: string): Promise<void> {
  await getDb().execute(sql`insert into source_apps (id, slug, name, environment, status, created_at, updated_at) values (${id}, ${id}, ${name}, 'test', 'ACTIVE', ${now}, ${now})`)
}

async function seedTicket(input: { id: string; appId: string; title: string; priority: string; status: string; createdAt: Date; escalatedAt?: string; triage?: string | null }): Promise<void> {
  const triage = input.triage === undefined
    ? JSON.stringify({ ownerRef: 'owner', ownerName: 'Source owner', escalatedAt: input.escalatedAt ?? '2026-08-12T14:00:00.000Z' })
    : input.triage
  await getDb().execute(sql`
    insert into feedback_tickets
      (id, source_app_id, external_id, kind, status, priority, title, description, url, raw_payload, triage,
       last_synced_at, created_at, updated_at)
    values
      (${input.id}, ${input.appId}, ${`external-${input.id}`}, 'BUG', ${input.status}::"FeedbackStatus",
       ${input.priority}::"FeedbackPriority", ${input.title}, 'Details', ${`https://source.example/${input.id}`}, '{}'::jsonb,
       ${triage}::jsonb,
       ${input.createdAt}, ${input.createdAt}, ${input.createdAt})
  `)
}

async function seedChannel(id: string): Promise<void> {
  await getDb().execute(sql`
    insert into support_groups (id, name, created_at, updated_at)
    values (${`group-${id}`}, ${`Group ${id}`}, ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into notification_channels
      (id, group_id, name, type, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at)
    values (${id}, ${`group-${id}`}, ${id}, 'EMAIL', 'ciphertext', 'nonce', 'tag', 1, ${now}, ${now})
  `)
}

async function seedDelivery(ticketId: string, status: string, generation = 1, targetKey = 'legacy:central-pushover', channelId: string | null = null, outboxGeneration = generation): Promise<void> {
  const configSource = channelId ? 'DATABASE' : 'LEGACY_ENV'
  await getDb().execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
    values (${`event-${ticketId}-${generation}`}, ${ticketId}, ${generation}, ${`key-${ticketId}-${generation}`}, '{}'::jsonb, ${now})
    on conflict (id) do nothing
  `)
  await getDb().execute(sql`
    insert into delivery_outbox
      (id, escalation_event_id, event_key, target_key, generation, channel_id, channel_type, config_source, rendered_payload,
       status, next_attempt_at, created_at, updated_at)
    values (${`outbox-${ticketId}-${generation}-${targetKey}-${outboxGeneration}`}, ${`event-${ticketId}-${generation}`}, ${`key-${ticketId}-${generation}`}, ${targetKey}, ${outboxGeneration}, ${channelId},
      ${channelId ? 'EMAIL' : 'PUSHOVER'}::"ChannelType", ${configSource}, '{}'::jsonb, ${status}::"DeliveryStatus", ${now}, ${now}, ${now})
  `)
}

async function seedDeliveryAttempt(ticketId: string, ordinal: number, startedAt: Date, resultClass: string, sanitizedError: string | null): Promise<void> {
  await getDb().execute(sql`
    insert into delivery_attempts
      (id, outbox_id, ordinal, target_key, started_at, finished_at, result_class, sanitized_error, created_at)
    values (${`attempt-${ticketId}-${ordinal}`}, ${`outbox-${ticketId}-1-legacy:central-pushover-1`}, ${ordinal}, 'legacy:central-pushover',
      ${startedAt}, ${startedAt}, ${resultClass}, ${sanitizedError}, ${startedAt})
  `)
}
