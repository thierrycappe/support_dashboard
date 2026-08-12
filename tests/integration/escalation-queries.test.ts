import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { getEscalationQueue } from '@/lib/escalations/queries'
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
})

async function seedApp(id: string, name: string): Promise<void> {
  await getDb().execute(sql`insert into source_apps (id, slug, name, environment, status, created_at, updated_at) values (${id}, ${id}, ${name}, 'test', 'ACTIVE', ${now}, ${now})`)
}

async function seedTicket(input: { id: string; appId: string; title: string; priority: string; status: string; createdAt: Date }): Promise<void> {
  await getDb().execute(sql`
    insert into feedback_tickets
      (id, source_app_id, external_id, kind, status, priority, title, description, url, raw_payload, triage,
       last_synced_at, created_at, updated_at)
    values
      (${input.id}, ${input.appId}, ${`external-${input.id}`}, 'BUG', ${input.status}::"FeedbackStatus",
       ${input.priority}::"FeedbackPriority", ${input.title}, 'Details', ${`https://source.example/${input.id}`}, '{}'::jsonb,
       '{"ownerRef":"owner","ownerName":"Source owner","escalatedAt":"2026-08-12T14:00:00.000Z"}'::jsonb,
       ${input.createdAt}, ${input.createdAt}, ${input.createdAt})
  `)
}

async function seedDelivery(ticketId: string, status: string): Promise<void> {
  await getDb().execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
    values (${`event-${ticketId}`}, ${ticketId}, 1, ${`key-${ticketId}`}, '{}'::jsonb, ${now})
  `)
  await getDb().execute(sql`
    insert into delivery_outbox
      (id, escalation_event_id, event_key, target_key, generation, channel_type, config_source, rendered_payload,
       status, next_attempt_at, created_at, updated_at)
    values (${`outbox-${ticketId}`}, ${`event-${ticketId}`}, ${`key-${ticketId}`}, 'legacy:central-pushover', 1,
      'PUSHOVER', 'LEGACY_ENV', '{}'::jsonb, ${status}::"DeliveryStatus", ${now}, ${now}, ${now})
  `)
}
