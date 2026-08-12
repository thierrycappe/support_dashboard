import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'
import type { FeedbackKind, FeedbackPriority, FeedbackStatus } from '@/lib/feedback/status'
import { OPEN_STATUSES } from '@/lib/feedback/status'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'
import { decodeEscalationCursor, encodeEscalationCursor } from '@/lib/escalations/search-params'

export interface EscalationQueueInput {
  search?: string
  appId?: string
  priority?: FeedbackPriority
  status?: FeedbackStatus
  cursor?: string
  limit: 50
}

export interface EscalationQueueRow {
  id: string
  title: string
  appId: string
  appName: string
  kind: FeedbackKind
  priority: FeedbackPriority
  status: FeedbackStatus
  deliveryStatus: string
  ownerApproval: string
  updatedAt: Date
  sourceUrl: string | null
}

export interface EscalationQueuePage {
  summary: { open: number; urgent: number; newToday: number; retrying: number }
  rows: EscalationQueueRow[]
  nextCursor: string | null
}

export async function getEscalationApplications(db: Db = getDb()): Promise<Array<{ id: string; name: string }>> {
  const result = await db.execute<{ id: string; name: string } & Record<string, unknown>>(sql`
    select id, name from source_apps order by name, id
  `)
  return result.rows
}

interface QueueDbRow extends Record<string, unknown> {
  id: string; title: string; appId: string; appName: string; kind: FeedbackKind
  priority: FeedbackPriority; status: FeedbackStatus; deliveryStatus: string | null
  ownerName: string | null; ownerRef: string | null; updatedAt: Date | string; sourceUrl: string | null
  appBaseUrl: string | null; appSlug: string
}

export async function getEscalationQueue({
  db = getDb(), now = new Date(), ...input
}: EscalationQueueInput & { db?: Db; now?: Date }): Promise<EscalationQueuePage> {
  if (input.limit !== 50) throw new Error('Escalation queue page size must be 50')
  const pageSize = 50
  const cursor = input.cursor ? decodeEscalationCursor(input.cursor) : null
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const escapedSearch = input.search ? `%${escapeLike(input.search)}%` : null
  const selectedStatuses = input.status ? [input.status] : OPEN_STATUSES
  const selectedStatusSql = sql.join(selectedStatuses.map((status) => sql`${status}::"FeedbackStatus"`), sql`, `)
  const openStatusSql = sql.join(OPEN_STATUSES.map((status) => sql`${status}::"FeedbackStatus"`), sql`, `)
  const rowResult = await db.execute<QueueDbRow>(sql`
    select ticket.id, ticket.title, ticket.source_app_id as "appId", app.name as "appName",
           app.base_url as "appBaseUrl", app.slug as "appSlug",
           ticket.kind, ticket.priority, ticket.status, ticket.updated_at as "updatedAt", ticket.url as "sourceUrl",
           ticket.triage->>'ownerName' as "ownerName", ticket.triage->>'ownerRef' as "ownerRef",
           delivery.status as "deliveryStatus"
      from feedback_tickets ticket
      join source_apps app on app.id = ticket.source_app_id
      left join lateral (
        select case
          when bool_or(outbox.status = 'FAILED') then 'FAILED'
          when bool_or(outbox.status = 'RETRYING') then 'RETRYING'
          when bool_or(outbox.status in ('PENDING', 'LEASED')) then 'PENDING'
          when bool_or(outbox.status = 'SENT') then 'SENT'
          else null end as status
          from escalation_events event
          join delivery_outbox outbox on outbox.escalation_event_id = event.id
         where event.ticket_id = ticket.id
      ) delivery on true
     where ticket.status in (${selectedStatusSql})
       and (${input.appId ?? null}::text is null or ticket.source_app_id = ${input.appId ?? null})
       and (${input.priority ?? null}::text is null or ticket.priority = ${input.priority ?? null}::"FeedbackPriority")
       and (${escapedSearch}::text is null or ticket.title ilike ${escapedSearch} escape '\\' or ticket.external_id ilike ${escapedSearch} escape '\\')
       and (${cursor?.updatedAt ?? null}::timestamptz is null or (ticket.updated_at, ticket.id) < (${cursor?.updatedAt ?? null}, ${cursor?.id ?? null}))
     order by ticket.updated_at desc, ticket.id desc
     limit ${pageSize + 1}
  `)
  const summaryResult = await db.execute<{ open: number; urgent: number; newToday: number; retrying: number } & Record<string, unknown>>(sql`
    select count(*) filter (where ticket.status in (${openStatusSql}))::int as open,
           count(*) filter (where ticket.status in (${openStatusSql}) and ticket.priority = 'URGENT')::int as urgent,
           count(*) filter (where ticket.created_at >= ${startOfDay} and ticket.created_at <= ${now})::int as "newToday",
           (select count(*)::int from delivery_outbox where status = 'RETRYING') as retrying
      from feedback_tickets ticket
  `)
  const hasMore = rowResult.rows.length > pageSize
  const rows = rowResult.rows.slice(0, pageSize).map((row): EscalationQueueRow => ({
    id: row.id, title: row.title, appId: row.appId, appName: row.appName, kind: row.kind,
    priority: row.priority, status: row.status, deliveryStatus: row.deliveryStatus ?? 'NOT_QUEUED',
    ownerApproval: row.ownerName ? `Approved by ${row.ownerName}` : row.ownerRef ? 'Approved in application' : 'Approval not recorded',
    updatedAt: new Date(row.updatedAt),
    sourceUrl: normalizeSourceTicketUrl(row.sourceUrl, row.appBaseUrl, row.appSlug),
  }))
  const last = rows.at(-1)
  return {
    summary: normalizeSummary(summaryResult.rows[0]), rows,
    nextCursor: hasMore && last ? encodeEscalationCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
  }
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/g, '\\$&') }
function normalizeSummary(row?: Record<string, unknown>) {
  return { open: Number(row?.open ?? 0), urgent: Number(row?.urgent ?? 0), newToday: Number(row?.newToday ?? 0), retrying: Number(row?.retrying ?? 0) }
}
