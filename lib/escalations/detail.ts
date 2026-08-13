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
    credentialMode: string
    activeCredential: boolean
    lastAuthenticatedAt: Date | null
  }
  approval: { ownerName: string | null; ownerRef: string; escalatedAt: Date } | null
  stale: boolean
  pullConfigured: boolean
  delivery: CurrentDeliveryState
  deliveryAttempts: DeliveryTimelineAttempt[]
}

export interface CurrentDeliveryState {
  eventGeneration: number | null
  targets: Array<{ target: string; status: string }>
  routingIncident: string | null
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
  eventGeneration: number
  eventId: string
}

interface DetailRow extends Record<string, unknown> {
  id: string; externalId: string; title: string; description: string; markdownSpec: string | null
  kind: FeedbackKind; priority: FeedbackPriority; status: FeedbackStatus; reporterName: string | null; reporterEmail: string | null
  lastSyncedAt: Date | string; appName: string; appSlug: string; appBaseUrl: string | null; sourceUrl: string | null
  enrollmentStatus: string; credentialMode: string; activeCredential: boolean; lastAuthenticatedAt: Date | string | null; approvalOwnerName: string | null; approvalOwnerRef: string | null; approvalEscalatedAt: string | null
}

interface AttemptRow extends Record<string, unknown> {
  id: string; target: string; ordinal: number | string; startedAt: Date | string; finishedAt: Date | string | null
  resultClass: string; providerStatus: string | null; sanitizedError: string | null; eventGeneration: number | string; eventId: string
}

interface CurrentDeliveryRow extends Record<string, unknown> {
  eventGeneration: number | string | null; target: string | null; status: string | null; routingIncident: string | null
  routingIncidentCreatedAt: Date | string | null
}

export async function getEscalationDetail(id: string, db: Db = getDb(), now = new Date()): Promise<EscalationDetail | null> {
  const approved = canonicalApprovedTriageSql(sql`ticket.triage`)
  const detailResult = await db.execute<DetailRow>(sql`
    select ticket.id, ticket.external_id as "externalId", ticket.title, ticket.description,
           ticket.markdown_spec as "markdownSpec", ticket.kind, ticket.priority, ticket.status,
           ticket.reporter_name as "reporterName", ticket.reporter_email as "reporterEmail",
           ticket.last_synced_at as "lastSyncedAt", ticket.url as "sourceUrl",
           app.name as "appName", app.slug as "appSlug", app.base_url as "appBaseUrl",
           app.enrollment_status as "enrollmentStatus", app.credential_mode as "credentialMode",
           exists (
             select 1 from app_credentials credential
              where credential.source_app_id = app.id
                and credential.status = 'ACTIVE'
                and credential.valid_from <= ${now}
                and (credential.valid_until is null or credential.valid_until > ${now})
           ) as "activeCredential",
           app.last_authenticated_at as "lastAuthenticatedAt",
           ticket.triage->>'ownerName' as "approvalOwnerName",
           ticket.triage->>'ownerRef' as "approvalOwnerRef",
           ticket.triage->>'escalatedAt' as "approvalEscalatedAt"
      from feedback_tickets ticket
      join source_apps app on app.id = ticket.source_app_id
     where ticket.id = ${id} and ${approved}
     limit 1
  `)
  const row = detailResult.rows[0]
  if (!row) return null

  const [attemptResult, currentDeliveryResult] = await Promise.all([
    db.execute<AttemptRow>(sql`
    select attempt.id, coalesce(channel.name, attempt.target_key) as target, attempt.ordinal,
           attempt.started_at as "startedAt", attempt.finished_at as "finishedAt",
           attempt.result_class as "resultClass", attempt.provider_status as "providerStatus",
           attempt.sanitized_error as "sanitizedError", event.generation as "eventGeneration", event.id as "eventId"
      from delivery_attempts attempt
      join delivery_outbox outbox on outbox.id = attempt.outbox_id
      join escalation_events event on event.id = outbox.escalation_event_id
      left join notification_channels channel on channel.id = outbox.channel_id
     where event.ticket_id = ${id}
     order by attempt.started_at asc, event.generation asc, attempt.created_at asc, attempt.id asc
  `),
    db.execute<CurrentDeliveryRow>(sql`
      with latest_event as (
        select event.id, event.generation
          from escalation_events event
         where event.ticket_id = ${id}
         order by event.generation desc, event.created_at desc, event.id desc
         limit 1
      ), latest_target as (
        select distinct on (outbox.target_key)
          coalesce(channel.name, outbox.target_key) as target,
          outbox.status::text as status
          from delivery_outbox outbox
          join latest_event event on event.id = outbox.escalation_event_id
          left join notification_channels channel on channel.id = outbox.channel_id
         order by outbox.target_key, outbox.generation desc, outbox.created_at desc, outbox.id desc
      )
      select event.generation as "eventGeneration", target.target, target.status,
             incident.reason as "routingIncident", incident.created_at as "routingIncidentCreatedAt"
        from latest_event event
        left join latest_target target on true
        left join lateral (
          select routing.reason, routing.created_at
            from routing_incidents routing
           where routing.escalation_event_id = event.id
           order by routing.created_at desc, routing.id desc
           limit 1
        ) incident on true
       order by target.target nulls last
    `),
  ])

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
      enrollmentStatus: row.enrollmentStatus, credentialMode: row.credentialMode,
      activeCredential: row.activeCredential, lastAuthenticatedAt: asDate(row.lastAuthenticatedAt),
    },
    approval: row.approvalOwnerRef && approvalEscalatedAt
      ? { ownerName: row.approvalOwnerName, ownerRef: row.approvalOwnerRef, escalatedAt: approvalEscalatedAt }
      : null,
    stale: isStaleTicket({ status: row.status, lastSyncedAt }, now),
    pullConfigured: false,
    delivery: buildCurrentDeliveryState(currentDeliveryResult.rows),
    deliveryAttempts: attemptResult.rows.map((attempt) => ({
      id: attempt.id, target: attempt.target, ordinal: Number(attempt.ordinal), startedAt: asDate(attempt.startedAt)!,
      finishedAt: asDate(attempt.finishedAt), resultClass: attempt.resultClass, providerStatus: attempt.providerStatus,
      sanitizedError: attempt.sanitizedError, eventGeneration: Number(attempt.eventGeneration), eventId: attempt.eventId,
    })),
  }
}

export function buildCurrentDeliveryState(rows: CurrentDeliveryRow[]): CurrentDeliveryState {
  const eventGeneration = rows[0]?.eventGeneration === null || rows[0]?.eventGeneration === undefined
    ? null
    : Number(rows[0].eventGeneration)
  const targets = new Map<string, string>()
  let latestIncident: { message: string; createdAt: Date } | null = null
  for (const row of rows) {
    if (row.target && row.status && !targets.has(row.target)) targets.set(row.target, row.status)
    const createdAt = asDate(row.routingIncidentCreatedAt)
    if (row.routingIncident && createdAt && (!latestIncident || createdAt > latestIncident.createdAt)) {
      latestIncident = { message: row.routingIncident, createdAt }
    }
  }
  return {
    eventGeneration,
    targets: [...targets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([target, status]) => ({ target, status })),
    routingIncident: latestIncident?.message ?? null,
  }
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value)
}
