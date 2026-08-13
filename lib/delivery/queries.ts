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
  nextAction: string
}

export interface DeliveryOperationsPage {
  rows: DeliveryOperationsRow[]
  summary: { deadLetters: number; routingIncidents: number; unhealthyChannels: number }
  nextCursor: string | null
}

export async function getDeadLetterCount(db: Db = getDb()): Promise<number> {
  const result = await db.execute<{ count: number } & Record<string, unknown>>(sql`
    ${currentStateCte}
    select count(*)::int as count from current_outbox where status = 'FAILED'
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
  const result = view === 'history'
    ? await getHistoricalDeliveries(db, decoded, limit)
    : await getCurrentDeliveries(db, view, limit)
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit).map(normalizeDelivery)
  const summaryResult = await db.execute<{ deadLetters: number; routingIncidents: number; unhealthyChannels: number } & Record<string, unknown>>(sql`
    ${currentStateCte}
    select
      (select count(*)::int from current_outbox where status = 'FAILED') as "deadLetters",
      (select count(*)::int from current_routing_incidents) as "routingIncidents",
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

const currentStateCte = sql`
  with latest_events as (
    select event.id, event.ticket_id, event.event_key
      from escalation_events event
     where event.generation = (
       select max(newer.generation)
         from escalation_events newer
        where newer.ticket_id = event.ticket_id
     )
  ), current_outbox as (
    select distinct on (event.ticket_id, outbox.target_key) outbox.*
      from latest_events event
      join delivery_outbox outbox on outbox.escalation_event_id = event.id
     order by event.ticket_id, outbox.target_key, outbox.generation desc, outbox.created_at desc, outbox.id desc
  ), current_routing_incidents as (
    select incident.id, incident.escalation_event_id, incident.reason, incident.created_at, event.event_key
      from latest_events event
      join routing_incidents incident on incident.escalation_event_id = event.id
  ), current_incidents as (
    select incident.id, incident.reason, incident.created_at, incident.event_key
      from current_routing_incidents incident
     where not exists (
       select 1 from delivery_outbox outbox where outbox.escalation_event_id = incident.escalation_event_id
     )
  )
`

async function getCurrentDeliveries(db: Db, view: Exclude<DeliveryOperationsView, 'history'>, limit: number) {
  const statusSql = statusesFor(view)
  const orderSql = view === 'failed'
    ? sql`current."createdAt" desc, current.id desc`
    : sql`current."nextAttemptAt" asc nulls last, current.id asc`
  return db.execute<DeliveryDbRow>(sql`
    ${currentStateCte}, current_rows as (
      select outbox.id, outbox.event_key as "eventKey", outbox.channel_type::text as "channelType",
             outbox.status::text as status, outbox.next_attempt_at as "nextAttemptAt",
             outbox.created_at as "createdAt", outbox.updated_at as "updatedAt", outbox.attempt_count as "attemptCount",
             coalesce(channel.name, case when outbox.config_source = 'LEGACY_ENV' then 'Central compatibility route' else 'Channel unavailable' end) as "channelName",
             coalesce(channel.redacted_destination, channel.recipient_display,
               case when outbox.config_source = 'LEGACY_ENV' then 'Central notification destination' else 'Destination unavailable' end) as destination,
             attempt.sanitized_error as "sanitizedCause", incident.reason as "routingIncident"
        from current_outbox outbox
        left join notification_channels channel on channel.id = outbox.channel_id
        left join lateral (
          select sanitized_error from delivery_attempts
           where outbox_id = outbox.id and sanitized_error is not null
           order by ordinal desc, created_at desc, id desc limit 1
        ) attempt on true
        left join routing_incidents incident on incident.escalation_event_id = outbox.escalation_event_id
      union all
      select concat('incident:', incident.id), incident.event_key, 'WEBHOOK', 'FAILED', null::timestamptz,
             incident.created_at, incident.created_at, 0::int, 'Routing decision', 'No active technical route',
             null, incident.reason
        from current_incidents incident
    )
    select * from current_rows current
     where current.status::"DeliveryStatus" in (${statusSql})
     order by ${orderSql}
     limit ${limit + 1}
  `)
}

async function getHistoricalDeliveries(db: Db, decoded: DeliveryCursor | null, limit: number) {
  const historyCursorSql = decoded
    ? sql`and (outbox.created_at, outbox.id) < (${decoded.createdAt}, ${decoded.id})`
    : sql``
  return db.execute<DeliveryDbRow>(sql`
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
      left join routing_incidents incident on incident.escalation_event_id = outbox.escalation_event_id
     where outbox.status in (${statusesFor('history')})
       ${historyCursorSql}
     order by outbox.created_at desc, outbox.id desc
     limit ${limit + 1}
  `)
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
    attemptCount: Number(row.attemptCount), retryAvailable: row.status === 'FAILED' && !row.id.startsWith('incident:'),
    nextAction: row.id.startsWith('incident:')
      ? 'Configure an active technical route, then resend the escalation.'
      : row.status === 'FAILED' ? 'Retry delivery' : 'Monitor delivery state',
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
