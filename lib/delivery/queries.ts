import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'

export type DeliveryOperationsView = 'pending' | 'retrying' | 'failed' | 'history'

export interface DeliveryOperationsRow {
  id: string
  eventKey: string
  channelName: string
  destination: string
  channelType: 'EMAIL' | 'PUSHOVER' | 'WEBHOOK'
  status: 'PENDING' | 'LEASED' | 'RETRYING' | 'SENT' | 'FAILED' | 'CANCELLED'
  nextAttemptAt: Date | null
  createdAt: Date
  updatedAt: Date
  attemptCount: number
  sanitizedCause: string | null
  routingIncident: string | null
  retryAvailable: boolean
}

export interface DeliveryOperationsPage {
  rows: DeliveryOperationsRow[]
  summary: { deadLetters: number; routingIncidents: number; unhealthyChannels: number }
  nextCursor: string | null
}

export async function getDeadLetterCount(db: Db = getDb()): Promise<number> {
  const result = await db.execute<{ count: number } & Record<string, unknown>>(sql`
    select count(*)::int as count from delivery_outbox where status = 'FAILED'
  `)
  return Number(result.rows[0]?.count ?? 0)
}

interface DeliveryCursor { createdAt: Date; id: string }

export async function getDeliveryOperations({
  db = getDb(),
  view,
  cursor,
  limit,
}: {
  db?: Db
  view: DeliveryOperationsView
  cursor?: string
  limit: 50
}): Promise<DeliveryOperationsPage> {
  if (limit !== 50) throw new Error('Delivery history page size must be 50')
  const decoded = cursor ? decodeCursor(cursor) : null
  const statusSql = statusesFor(view)
  const historyCursorSql = view === 'history' && decoded
    ? sql`and (outbox.created_at, outbox.id) < (${decoded.createdAt}, ${decoded.id})`
    : sql``
  const orderSql = view === 'failed' || view === 'history'
    ? sql`outbox.created_at desc, outbox.id desc`
    : sql`outbox.next_attempt_at asc, outbox.id asc`
  const result = await db.execute<DeliveryDbRow>(sql`
    select outbox.id, outbox.event_key as "eventKey", outbox.channel_type::text as "channelType",
           outbox.status::text as status, outbox.next_attempt_at as "nextAttemptAt",
           outbox.created_at as "createdAt", outbox.updated_at as "updatedAt", outbox.attempt_count as "attemptCount",
           coalesce(channel.name, case when outbox.config_source = 'LEGACY_ENV' then 'Central compatibility route' else 'Channel unavailable' end) as "channelName",
           coalesce(channel.redacted_destination, channel.recipient_display,
             case when outbox.config_source = 'LEGACY_ENV' then 'Central notification destination' else 'Destination unavailable' end) as destination,
           attempt.sanitized_error as "sanitizedCause", incident.reason as "routingIncident"
      from delivery_outbox outbox
      left join notification_channels channel on channel.id = outbox.channel_id
      left join lateral (
        select sanitized_error from delivery_attempts
         where outbox_id = outbox.id and sanitized_error is not null
         order by ordinal desc, created_at desc, id desc limit 1
      ) attempt on true
      left join lateral (
        select routing.reason from routing_incidents routing
         join escalation_events event on event.id = routing.escalation_event_id
         where event.id = outbox.escalation_event_id
         order by routing.created_at desc, routing.id desc limit 1
      ) incident on true
     where outbox.status in (${statusSql})
       ${historyCursorSql}
     order by ${orderSql}
     limit ${limit + 1}
  `)
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit).map(normalizeDelivery)
  const summaryResult = await db.execute<{ deadLetters: number; routingIncidents: number; unhealthyChannels: number } & Record<string, unknown>>(sql`
    select
      (select count(*)::int from delivery_outbox where status = 'FAILED') as "deadLetters",
      (select count(*)::int from routing_incidents) as "routingIncidents",
      (select count(*)::int from notification_channels where status = 'UNHEALTHY') as "unhealthyChannels"
  `)
  const last = rows.at(-1)
  return {
    rows,
    summary: normalizeSummary(summaryResult.rows[0]),
    nextCursor: hasMore && last && view === 'history' ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  }
}

function statusesFor(view: DeliveryOperationsView) {
  const statuses: Record<DeliveryOperationsView, string[]> = {
    pending: ['PENDING', 'LEASED'], retrying: ['RETRYING'], failed: ['FAILED'],
    history: ['SENT', 'CANCELLED', 'FAILED'],
  }
  return sql.join(statuses[view].map((status) => sql`${status}::"DeliveryStatus"`), sql`, `)
}

interface DeliveryDbRow extends Record<string, unknown> {
  id: string; eventKey: string; channelName: string; destination: string; channelType: DeliveryOperationsRow['channelType']
  status: DeliveryOperationsRow['status']; nextAttemptAt: Date | string | null; createdAt: Date | string; updatedAt: Date | string
  attemptCount: number | string; sanitizedCause: string | null; routingIncident: string | null
}

function normalizeDelivery(row: DeliveryDbRow): DeliveryOperationsRow {
  return {
    ...row,
    nextAttemptAt: asDate(row.nextAttemptAt), createdAt: asDate(row.createdAt)!, updatedAt: asDate(row.updatedAt)!,
    attemptCount: Number(row.attemptCount), retryAvailable: row.status === 'FAILED',
  }
}

function normalizeSummary(row?: Record<string, unknown>) {
  return {
    deadLetters: Number(row?.deadLetters ?? 0), routingIncidents: Number(row?.routingIncidents ?? 0),
    unhealthyChannels: Number(row?.unhealthyChannels ?? 0),
  }
}
function asDate(value: Date | string | null): Date | null { return value === null ? null : value instanceof Date ? value : new Date(value) }
function encodeCursor(cursor: DeliveryCursor): string { return Buffer.from(JSON.stringify({ v: 1, t: cursor.createdAt.toISOString(), i: cursor.id })).toString('base64url') }
function decodeCursor(value: string): DeliveryCursor | null {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.v !== 1 || typeof record.t !== 'string' || typeof record.i !== 'string' || !record.i) return null
    const createdAt = new Date(record.t)
    return Number.isFinite(createdAt.getTime()) && createdAt.toISOString() === record.t ? { createdAt, id: record.i } : null
  } catch { return null }
}
