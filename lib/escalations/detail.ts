import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'
import { canonicalApprovedTriageSql } from '@/lib/escalations/approval'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'
import { isStaleTicket, type FeedbackKind, type FeedbackPriority, type FeedbackStatus } from '@/lib/feedback/status'

export interface EscalationDetail {
  ticket: {
    id: string
    externalId: string
    title: string
    description: string
    markdownSpec: string | null
    kind: FeedbackKind
    priority: FeedbackPriority
    status: FeedbackStatus
    reporterName: string | null
    reporterEmail: string | null
    lastSyncedAt: Date
  }
  application: {
    name: string
    slug: string
    sourceUrl: string | null
    enrollmentStatus: string
    lastAuthenticatedAt: Date | null
  }
  approval: { ownerName: string | null; ownerRef: string; escalatedAt: Date } | null
  stale: boolean
  pullConfigured: boolean
  deliveryAttempts: DeliveryTimelineAttempt[]
}

export interface DeliveryTimelineAttempt {
  id: string
  target: string
  ordinal: number
  startedAt: Date
  finishedAt: Date | null
  resultClass: string
  providerStatus: string | null
  sanitizedError: string | null
}

interface DetailRow extends Record<string, unknown> {
  id: string; externalId: string; title: string; description: string; markdownSpec: string | null
  kind: FeedbackKind; priority: FeedbackPriority; status: FeedbackStatus; reporterName: string | null; reporterEmail: string | null
  lastSyncedAt: Date | string; appName: string; appSlug: string; appBaseUrl: string | null; sourceUrl: string | null
  enrollmentStatus: string; lastAuthenticatedAt: Date | string | null; approvalOwnerName: string | null; approvalOwnerRef: string | null; approvalEscalatedAt: string | null
}

interface AttemptRow extends Record<string, unknown> {
  id: string; target: string; ordinal: number | string; startedAt: Date | string; finishedAt: Date | string | null
  resultClass: string; providerStatus: string | null; sanitizedError: string | null
}

export async function getEscalationDetail(id: string, db: Db = getDb(), now = new Date()): Promise<EscalationDetail | null> {
  const approved = canonicalApprovedTriageSql(sql`ticket.triage`)
  const detailResult = await db.execute<DetailRow>(sql`
    select ticket.id, ticket.external_id as "externalId", ticket.title, ticket.description,
           ticket.markdown_spec as "markdownSpec", ticket.kind, ticket.priority, ticket.status,
           ticket.reporter_name as "reporterName", ticket.reporter_email as "reporterEmail",
           ticket.last_synced_at as "lastSyncedAt", ticket.url as "sourceUrl",
           app.name as "appName", app.slug as "appSlug", app.base_url as "appBaseUrl",
           app.enrollment_status as "enrollmentStatus", app.last_authenticated_at as "lastAuthenticatedAt",
           case when ${approved} then ticket.triage->>'ownerName' else null end as "approvalOwnerName",
           case when ${approved} then ticket.triage->>'ownerRef' else null end as "approvalOwnerRef",
           case when ${approved} then ticket.triage->>'escalatedAt' else null end as "approvalEscalatedAt"
      from feedback_tickets ticket
      join source_apps app on app.id = ticket.source_app_id
     where ticket.id = ${id}
     limit 1
  `)
  const row = detailResult.rows[0]
  if (!row) return null

  const attemptResult = await db.execute<AttemptRow>(sql`
    select attempt.id, coalesce(channel.name, attempt.target_key) as target, attempt.ordinal,
           attempt.started_at as "startedAt", attempt.finished_at as "finishedAt",
           attempt.result_class as "resultClass", attempt.provider_status as "providerStatus",
           attempt.sanitized_error as "sanitizedError"
      from delivery_attempts attempt
      join delivery_outbox outbox on outbox.id = attempt.outbox_id
      join escalation_events event on event.id = outbox.escalation_event_id
      left join notification_channels channel on channel.id = outbox.channel_id
     where event.ticket_id = ${id}
     order by attempt.started_at asc, attempt.created_at asc, attempt.id asc
  `)

  const lastSyncedAt = asDate(row.lastSyncedAt)!
  const approvalEscalatedAt = row.approvalEscalatedAt ? asDate(row.approvalEscalatedAt) : null
  return {
    ticket: {
      id: row.id, externalId: row.externalId, title: row.title, description: row.description,
      markdownSpec: row.markdownSpec, kind: row.kind, priority: row.priority, status: row.status,
      reporterName: row.reporterName, reporterEmail: row.reporterEmail, lastSyncedAt,
    },
    application: {
      name: row.appName, slug: row.appSlug,
      sourceUrl: normalizeSourceTicketUrl(row.sourceUrl, row.appBaseUrl, row.appSlug),
      enrollmentStatus: row.enrollmentStatus, lastAuthenticatedAt: asDate(row.lastAuthenticatedAt),
    },
    approval: row.approvalOwnerRef && approvalEscalatedAt
      ? { ownerName: row.approvalOwnerName, ownerRef: row.approvalOwnerRef, escalatedAt: approvalEscalatedAt }
      : null,
    stale: isStaleTicket({ status: row.status, lastSyncedAt }, now),
    pullConfigured: false,
    deliveryAttempts: attemptResult.rows.map((attempt) => ({
      id: attempt.id, target: attempt.target, ordinal: Number(attempt.ordinal), startedAt: asDate(attempt.startedAt)!,
      finishedAt: asDate(attempt.finishedAt), resultClass: attempt.resultClass, providerStatus: attempt.providerStatus,
      sanitizedError: attempt.sanitizedError,
    })),
  }
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value)
}
