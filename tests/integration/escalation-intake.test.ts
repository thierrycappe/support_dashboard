import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql, type SQL } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import {
  appNotificationPolicies,
  deliveryOutbox,
  escalationEvents,
  notificationChannels,
  routingIncidents,
  sourceApps,
  supportGroups,
} from '@/lib/db/schema'
import { IntakeError } from '@/lib/escalations/errors'
import {
  acceptEscalation,
  type AcceptEscalationInput,
  type IntakeDependencies,
} from '@/lib/escalations/intake'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:00.000Z')
const appId = 'task5-app'
const appGroupId = 'task5-app-group'
const centralGroupId = 'task5-central-group'
const appChannelId = 'task5-app-channel'
const centralChannelId = 'task5-central-channel'

const command = {
  externalId: 'FEEDBACK-1842',
  kind: 'BUG' as const,
  status: 'NEW' as const,
  priority: 'HIGH' as const,
  title: 'Cannot publish a schedule',
  description: 'Private diagnostic description',
  sourceUrl: 'https://source.example.test/feedback/FEEDBACK-1842',
  triage: {
    ownerRef: 'business-owner-42',
    ownerName: 'Camille Renard',
    escalatedAt: '2026-08-12T11:30:00.000Z',
  },
  reporter: {
    name: 'Elodie Martin',
    email: 'elodie@example.test',
    sourceId: 'reporter-42',
  },
  browserInfo: 'Safari',
  markdownSpec: null,
  transcript: null,
  remoteCreatedAt: '2026-08-12T11:00:00.000Z',
  remoteUpdatedAt: '2026-08-12T11:30:00.000Z',
  metadata: { source: 'integration-test' },
}

const input: AcceptEscalationInput = {
  appId,
  credentialId: null,
  idempotencyKey: 'request-1',
  command,
  receivedAt: now,
}

beforeEach(async () => {
  await getDb().execute(sql`truncate table audit_events, source_apps, support_groups cascade`)
})

afterAll(async () => {
  await closeDbPool()
})

describe('acceptEscalation', () => {
  it('rolls back ticket and receipt when outbox creation fails', async () => {
    await seedRouting()
    const testDependencies: IntakeDependencies = {
      db: getDb(),
      resolveTargets: async () => ({
        targets: [{
          targetKey: 'channel:missing',
          channelId: 'missing',
          channelType: 'EMAIL',
          configSource: 'DATABASE',
          includeReporterContext: false,
        }],
        incident: null,
      }),
    }

    await expect(acceptEscalation(input, testDependencies)).rejects.toThrow()

    expect(await countTickets(input.appId)).toBe(0)
    expect(await countReceipts(input.appId)).toBe(0)
    expect(await countEvents()).toBe(0)
    expect(await countAuditEvents()).toBe(0)
  })

  it('rolls back the outbox when a later audit write fails', async () => {
    await seedRouting()
    await getDb().execute(sql`
      create function task5_fail_audit_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'task5 forced audit failure';
      end;
      $$;
      create trigger task5_fail_audit_insert
        before insert on audit_events
        for each row execute function task5_fail_audit_insert();
    `)

    try {
      await expect(acceptEscalation(input)).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining('task5 forced audit failure'),
        }),
      })

      expect(await countTickets(input.appId)).toBe(0)
      expect(await countReceipts(input.appId)).toBe(0)
      expect(await countEvents()).toBe(0)
      expect(await countOutboxRowsForApp(input.appId)).toBe(0)
      expect(await countAuditEvents()).toBe(0)
    } finally {
      await getDb().execute(sql`
        drop trigger if exists task5_fail_audit_insert on audit_events;
        drop function if exists task5_fail_audit_insert();
      `)
    }
  })

  it('uses default dependencies to persist a ticket, immutable event, outbox target, and audit record', async () => {
    await seedRouting()

    const result = await acceptEscalation(input)

    expect(result).toEqual({
      appId,
      ticketId: expect.any(String),
      result: 'created',
      acceptedAt: now,
    })
    expect(await countTickets(input.appId)).toBe(1)
    expect(await countReceipts(input.appId)).toBe(1)
    expect(await countEvents()).toBe(1)
    expect(await countOutboxRows(result.ticketId)).toBe(1)
    expect(await countAuditEvents()).toBe(1)
    const [event] = await getDb()
      .select({ payload: escalationEvents.payload })
      .from(escalationEvents)
    expect(event?.payload).not.toHaveProperty('description')
    expect(event?.payload).not.toHaveProperty('reporter')
  })

  it('persists the legacy environment target without inventing a channel ID', async () => {
    await seedRouting()
    const testDependencies: IntakeDependencies = {
      db: getDb(),
      resolveTargets: async () => ({
        targets: [{
          targetKey: 'legacy:central-pushover',
          channelId: null,
          channelType: 'PUSHOVER',
          configSource: 'LEGACY_ENV',
          includeReporterContext: false,
        }],
        incident: null,
      }),
    }

    const result = await acceptEscalation(input, testDependencies)
    const rows = await getDb()
      .select({
        targetKey: deliveryOutbox.targetKey,
        channelId: deliveryOutbox.channelId,
        channelType: deliveryOutbox.channelType,
        configSource: deliveryOutbox.configSource,
      })
      .from(deliveryOutbox)

    expect(result.result).toBe('created')
    expect(rows).toEqual([{
      targetKey: 'legacy:central-pushover',
      channelId: null,
      channelType: 'PUSHOVER',
      configSource: 'LEGACY_ENV',
    }])
  })

  it('returns the original result for the same idempotency key and digest', async () => {
    await seedRouting()

    const first = await acceptEscalation(input)
    const second = await acceptEscalation(input)

    expect(second).toEqual({ ...first, result: 'duplicate' })
    expect(await countOutboxRows(first.ticketId)).toBe(1)
    expect(await countEvents()).toBe(1)
  })

  it('rejects a changed payload under the same idempotency key', async () => {
    await seedRouting()
    await acceptEscalation(input)

    await expect(
      acceptEscalation({ ...input, command: { ...input.command, title: 'Changed title' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' } satisfies Partial<IntakeError>)
  })

  it('creates one ticket, receipt, and target row for ten concurrent matching requests', async () => {
    await seedRouting()

    const results = await Promise.all(Array.from({ length: 10 }, () => acceptEscalation(input)))

    expect(results.filter((result) => result.result === 'created')).toHaveLength(1)
    expect(results.filter((result) => result.result === 'duplicate')).toHaveLength(9)
    expect(await countTickets(input.appId)).toBe(1)
    expect(await countReceipts(input.appId)).toBe(1)
    expect(await countEvents()).toBe(1)
    expect(await countOutboxRows(results[0]!.ticketId)).toBe(1)
  })

  it('creates a new immutable event generation for a materially changed escalation', async () => {
    await seedRouting()
    const first = await acceptEscalation(input)

    const second = await acceptEscalation({
      ...input,
      idempotencyKey: 'request-2',
      command: { ...input.command, title: 'Updated schedule failure' },
    })

    expect(second).toMatchObject({ ticketId: first.ticketId, result: 'updated' })
    expect(await eventGenerations(first.ticketId)).toEqual([1, 2])
    expect(await countOutboxRows(first.ticketId)).toBe(2)
  })

  it('copies urgent escalations to central even when legacy policy flags are false', async () => {
    await seedRouting({ urgentCentralCopy: false, fallbackToCentral: false })

    const result = await acceptEscalation({
      ...input,
      command: { ...input.command, priority: 'URGENT' },
    })

    expect(await countOutboxRows(result.ticketId)).toBe(2)
  })

  it('uses the central fallback when no app channel is valid despite a false legacy policy flag', async () => {
    await seedRouting({ appChannel: false, centralChannel: true, fallbackToCentral: false })

    const result = await acceptEscalation(input)

    expect(await countOutboxRows(result.ticketId)).toBe(1)
    expect(await routingReasons()).toEqual([])
  })

  it('persists a visible routing incident when neither app nor central has a valid target', async () => {
    await seedRouting({ appChannel: false, centralChannel: false })

    const result = await acceptEscalation(input)

    expect(await countOutboxRows(result.ticketId)).toBe(0)
    expect(await routingReasons()).toEqual(['NO_VALID_DELIVERY_TARGET'])
    expect(await countAuditEvents()).toBe(1)
  })
})

async function seedRouting(options: {
  appChannel?: boolean
  centralChannel?: boolean
  urgentCentralCopy?: boolean
  fallbackToCentral?: boolean
} = {}): Promise<void> {
  const appChannel = options.appChannel ?? true
  const centralChannel = options.centralChannel ?? true
  const db = getDb()

  await db.insert(supportGroups).values([
    { id: appGroupId, name: 'Task 5 app owners', status: 'ACTIVE', isCentralFallback: false, createdAt: now, updatedAt: now },
    { id: centralGroupId, name: 'Task 5 central', status: 'ACTIVE', isCentralFallback: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(sourceApps).values({
    id: appId,
    slug: 'task5-app',
    name: 'Task 5 App',
    environment: 'test',
    status: 'ACTIVE',
    enrollmentStatus: 'ACTIVE',
    credentialMode: 'PUBLIC_KEY',
    technicalGroupId: appGroupId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(appNotificationPolicies).values({
    id: 'task5-policy',
    sourceAppId: appId,
    minimumPriority: 'MEDIUM',
    urgentCentralCopy: options.urgentCentralCopy ?? true,
    fallbackToCentral: options.fallbackToCentral ?? true,
    createdAt: now,
    updatedAt: now,
  })

  const channels = []
  if (appChannel) {
    channels.push({
      id: appChannelId,
      groupId: appGroupId,
      name: 'App email',
      type: 'EMAIL' as const,
      status: 'ACTIVE' as const,
      encryptedConfig: 'ciphertext',
      configNonce: 'nonce',
      configAuthTag: 'tag',
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
  }
  if (centralChannel) {
    channels.push({
      id: centralChannelId,
      groupId: centralGroupId,
      name: 'Central pushover',
      type: 'PUSHOVER' as const,
      status: 'ACTIVE' as const,
      encryptedConfig: 'ciphertext',
      configNonce: 'nonce',
      configAuthTag: 'tag',
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
  }
  if (channels.length > 0) await db.insert(notificationChannels).values(channels)
}

async function countTickets(sourceAppId: string): Promise<number> {
  return scalarCount(sql`
    select count(*)::int as count from feedback_tickets where source_app_id = ${sourceAppId}
  `)
}

async function countReceipts(sourceAppId: string): Promise<number> {
  return scalarCount(sql`
    select count(*)::int as count from ingest_receipts where source_app_id = ${sourceAppId}
  `)
}

async function countEvents(): Promise<number> {
  return scalarCount(sql`select count(*)::int as count from escalation_events`)
}

async function countOutboxRows(ticketId: string): Promise<number> {
  return scalarCount(sql`
    select count(*)::int as count from delivery_outbox
     where escalation_event_id in (select id from escalation_events where ticket_id = ${ticketId})
  `)
}

async function countOutboxRowsForApp(sourceAppId: string): Promise<number> {
  return scalarCount(sql`
    select count(*)::int as count from delivery_outbox
     where escalation_event_id in (
       select escalation_events.id
       from escalation_events
       inner join feedback_tickets on feedback_tickets.id = escalation_events.ticket_id
       where feedback_tickets.source_app_id = ${sourceAppId}
     )
  `)
}

async function countAuditEvents(): Promise<number> {
  return scalarCount(sql`select count(*)::int as count from audit_events`)
}

async function scalarCount(query: SQL): Promise<number> {
  const result = await getDb().execute<{ count: number }>(query)
  return result.rows[0]?.count ?? 0
}

async function eventGenerations(ticketId: string): Promise<number[]> {
  const rows = await getDb()
    .select({ generation: escalationEvents.generation })
    .from(escalationEvents)
    .where(eq(escalationEvents.ticketId, ticketId))
    .orderBy(escalationEvents.generation)
  return rows.map((row) => row.generation)
}

async function routingReasons(): Promise<string[]> {
  const rows = await getDb()
    .select({ reason: routingIncidents.reason })
    .from(routingIncidents)
    .orderBy(routingIncidents.reason)
  return rows.map((row) => row.reason)
}
