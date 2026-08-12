import { nanoid } from 'nanoid'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, type Db, type DbTransaction } from '@/lib/db'
import {
  auditEvents,
  deliveryOutbox,
  escalationEvents,
  feedbackTickets,
  ingestReceipts,
  routingIncidents,
  sourceApps,
} from '@/lib/db/schema'
import { renderDeliveryEvent } from '@/lib/delivery/render'
import type { DeliveryEvent, DeliveryEventInput, DeliveryTarget, RoutingDecision } from '@/lib/delivery/types'
import type { FeedbackPriority } from '@/lib/feedback/status'
import {
  canonicalEscalationDigest,
  type EscalationCommand,
} from '@/lib/escalations/contract'
import { IntakeError } from '@/lib/escalations/errors'
import { resolveTargetsFromDb } from '@/lib/escalations/repository'
import { getTowerPublicUrl } from '@/lib/notifications/pushover'

export interface AcceptEscalationInput {
  appId: string
  credentialId: string | null
  idempotencyKey: string
  command: EscalationCommand
  receivedAt?: Date
}

export interface IntakeResult {
  appId: string
  ticketId: string
  result: 'created' | 'updated' | 'duplicate'
  acceptedAt: Date
}

export interface IntakeDependencies {
  db: Db
  portalOrigin?: string
  resolveTargets(
    tx: DbTransaction,
    appId: string,
    priority: FeedbackPriority,
  ): Promise<RoutingDecision>
}

type ClaimedReceipt = { kind: 'claimed'; id: string }
type DuplicateReceipt = { kind: 'duplicate'; result: IntakeResult }
type ConflictingReceipt = { kind: 'conflict' }
type ReceiptClaim = ClaimedReceipt | DuplicateReceipt | ConflictingReceipt

interface PersistedTicket {
  id: string
  materialChange: boolean
  result: 'created' | 'updated'
}

interface EscalationEventRecord {
  id: string
  eventKey: string
  generation: number
  payload: Record<string, unknown>
}

export async function acceptEscalation(
  input: AcceptEscalationInput,
  deps?: IntakeDependencies,
): Promise<IntakeResult> {
  const dependencies = deps ?? {
    db: getDb(),
    resolveTargets: resolveTargetsFromDb,
  }
  const portalOrigin = trustedPortalOrigin(dependencies.portalOrigin)
  const digest = canonicalEscalationDigest(input.command)
  const acceptedAt = input.receivedAt ?? new Date()

  return dependencies.db.transaction(async (tx) => {
    const receipt = await claimReceipt(tx, input, digest, acceptedAt)
    if (receipt.kind === 'duplicate') return receipt.result
    if (receipt.kind === 'conflict') throw new IntakeError('IDEMPOTENCY_CONFLICT')

    await lockTicketIdentity(tx, input.appId, input.command.externalId)
    const ticket = await upsertEscalationTicket(tx, input, digest, acceptedAt)
    const routing = ticket.materialChange
      ? await dependencies.resolveTargets(tx, input.appId, input.command.priority)
      : { targets: [], incident: null }
    const appName = await appNameFor(tx, input.appId)
    const deliveryEventInput: DeliveryEventInput = {
      ticketId: ticket.id,
      appName,
      kind: input.command.kind,
      priority: input.command.priority,
      title: input.command.title,
      description: input.command.description,
      reporter: input.command.reporter,
      includeReporterContext: false,
    }
    const defaultDeliveryEvent = renderDeliveryEvent(deliveryEventInput, { portalOrigin })
    const event = ticket.materialChange
      ? await insertEscalationEvent(tx, ticket.id, input, digest, acceptedAt)
      : null

    if (event) {
      await insertDeliveryOutbox(
        tx,
        event,
        routing.targets,
        defaultDeliveryEvent,
        deliveryEventInput,
        portalOrigin,
        acceptedAt,
      )
      await insertRoutingIncident(tx, event.id, routing, acceptedAt)
    }

    await appendAcceptedAudit(tx, input, ticket, acceptedAt)
    return finalizeReceipt(tx, receipt.id, input.appId, ticket, acceptedAt)
  })
}

async function claimReceipt(
  tx: DbTransaction,
  input: AcceptEscalationInput,
  digest: string,
  acceptedAt: Date,
): Promise<ReceiptClaim> {
  const receiptId = nanoid()
  const claimed = await tx
    .insert(ingestReceipts)
    .values({
      id: receiptId,
      sourceAppId: input.appId,
      idempotencyKey: input.idempotencyKey,
      canonicalDigest: digest,
      ticketId: null,
      result: 'PENDING',
      responseSnapshot: {},
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    })
    .onConflictDoNothing()
    .returning({ id: ingestReceipts.id })
  if (claimed.length > 0) return { kind: 'claimed', id: receiptId }

  const existing = await tx
    .select({
      canonicalDigest: ingestReceipts.canonicalDigest,
      responseSnapshot: ingestReceipts.responseSnapshot,
    })
    .from(ingestReceipts)
    .where(and(
      eq(ingestReceipts.sourceAppId, input.appId),
      eq(ingestReceipts.idempotencyKey, input.idempotencyKey),
    ))
    .for('update')
    .limit(1)
  const receipt = existing[0]
  if (!receipt || receipt.canonicalDigest !== digest) return { kind: 'conflict' }

  return { kind: 'duplicate', result: readDuplicateResult(receipt.responseSnapshot) }
}

function readDuplicateResult(snapshot: Record<string, unknown>): IntakeResult {
  const acceptedAt = snapshot.acceptedAt
  const appId = snapshot.appId
  const ticketId = snapshot.ticketId
  const result = snapshot.result

  if (
    typeof appId !== 'string'
    || typeof ticketId !== 'string'
    || (result !== 'created' && result !== 'updated')
    || typeof acceptedAt !== 'string'
  ) {
    throw new Error('Stored ingest receipt has no finalized response')
  }

  return { appId, ticketId, result: 'duplicate', acceptedAt: new Date(acceptedAt) }
}

async function lockTicketIdentity(
  tx: DbTransaction,
  appId: string,
  externalId: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext(${`${appId}:${externalId}`}))
  `)
}

async function upsertEscalationTicket(
  tx: DbTransaction,
  input: AcceptEscalationInput,
  digest: string,
  acceptedAt: Date,
): Promise<PersistedTicket> {
  const existingRows = await tx
    .select({
      id: feedbackTickets.id,
      rawPayload: feedbackTickets.rawPayload,
    })
    .from(feedbackTickets)
    .where(and(
      eq(feedbackTickets.sourceAppId, input.appId),
      eq(feedbackTickets.externalId, input.command.externalId),
    ))
    .for('update')
    .limit(1)
  const existing = existingRows[0]
  const materialChange = existing
    ? existing.rawPayload.canonicalDigest !== digest
    : true

  if (existing && !materialChange) {
    return { id: existing.id, materialChange: false, result: 'updated' }
  }

  const values = ticketValues(input.command, digest, acceptedAt)
  if (!existing) {
    const id = nanoid()
    await tx.insert(feedbackTickets).values({ id, sourceAppId: input.appId, ...values, createdAt: acceptedAt })
    return { id, materialChange: true, result: 'created' }
  }

  await tx.update(feedbackTickets).set(values).where(eq(feedbackTickets.id, existing.id))
  return { id: existing.id, materialChange: true, result: 'updated' }
}

function ticketValues(
  command: EscalationCommand,
  digest: string,
  acceptedAt: Date,
) {
  return {
    externalId: command.externalId,
    kind: command.kind,
    status: command.status,
    priority: command.priority,
    title: command.title,
    description: command.description,
    reporterName: command.reporter.name,
    reporterEmail: command.reporter.email,
    reporterId: command.reporter.sourceId,
    url: command.sourceUrl,
    browserInfo: command.browserInfo,
    markdownSpec: command.markdownSpec,
    transcript: command.transcript,
    rawPayload: { canonicalDigest: digest, escalationCommand: command },
    triage: command.triage,
    remoteCreatedAt: toDate(command.remoteCreatedAt),
    remoteUpdatedAt: toDate(command.remoteUpdatedAt),
    lastStatusChangeAt: acceptedAt,
    lastSyncedAt: acceptedAt,
    updatedAt: acceptedAt,
  }
}

async function insertEscalationEvent(
  tx: DbTransaction,
  ticketId: string,
  input: AcceptEscalationInput,
  digest: string,
  acceptedAt: Date,
): Promise<EscalationEventRecord> {
  const priorEvents = await tx
    .select({ generation: escalationEvents.generation })
    .from(escalationEvents)
    .where(eq(escalationEvents.ticketId, ticketId))
    .orderBy(desc(escalationEvents.generation))
    .limit(1)
  const generation = (priorEvents[0]?.generation ?? 0) + 1
  const event: EscalationEventRecord = {
    id: nanoid(),
    eventKey: nanoid(),
    generation,
    payload: {
      ticketId,
      appId: input.appId,
      kind: input.command.kind,
      priority: input.command.priority,
      title: input.command.title,
      canonicalDigest: digest,
    },
  }

  await tx.insert(escalationEvents).values({
    ...event,
    ticketId,
    createdAt: acceptedAt,
  })
  return event
}

async function insertDeliveryOutbox(
  tx: DbTransaction,
  event: EscalationEventRecord,
  targets: DeliveryTarget[],
  defaultDeliveryEvent: DeliveryEvent,
  deliveryEventInput: DeliveryEventInput,
  portalOrigin: string,
  acceptedAt: Date,
): Promise<void> {
  if (targets.length === 0) return

  await tx.insert(deliveryOutbox).values(targets.map((target) => ({
    id: nanoid(),
    escalationEventId: event.id,
    eventKey: event.eventKey,
    targetKey: target.targetKey,
    generation: event.generation,
    channelId: target.channelId,
    channelType: target.channelType,
    configSource: target.configSource,
    renderedPayload: renderedPayload(target.configSource === 'DATABASE' && target.includeReporterContext
      ? renderDeliveryEvent({ ...deliveryEventInput, includeReporterContext: true }, { portalOrigin })
      : defaultDeliveryEvent),
    status: 'PENDING' as const,
    nextAttemptAt: acceptedAt,
    attemptCount: 0,
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
  })))
}

function renderedPayload(event: DeliveryEvent): Record<string, unknown> {
  return event.reporterContext
    ? { ...event, reporterContext: { ...event.reporterContext } }
    : { ...event }
}

async function appNameFor(tx: DbTransaction, appId: string): Promise<string> {
  const appRows = await tx
    .select({ name: sourceApps.name })
    .from(sourceApps)
    .where(eq(sourceApps.id, appId))
    .limit(1)
  const app = appRows[0]
  if (!app) throw new Error(`Source app not found: ${appId}`)
  return app.name
}

function trustedPortalOrigin(configuredOrigin?: string): string {
  const portalOrigin = configuredOrigin ?? getTowerPublicUrl()
  if (!portalOrigin) {
    throw new Error('SUPPORT_TOWER_PUBLIC_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL must be configured')
  }
  return portalOrigin
}

async function insertRoutingIncident(
  tx: DbTransaction,
  escalationEventId: string,
  routing: RoutingDecision,
  acceptedAt: Date,
): Promise<void> {
  if (!routing.incident) return

  await tx.insert(routingIncidents).values({
    id: nanoid(),
    escalationEventId,
    reason: routing.incident.code,
    details: {},
    createdAt: acceptedAt,
  })
}

async function appendAcceptedAudit(
  tx: DbTransaction,
  input: AcceptEscalationInput,
  ticket: PersistedTicket,
  acceptedAt: Date,
): Promise<void> {
  await tx.insert(auditEvents).values({
    id: nanoid(),
    actorType: 'APPLICATION',
    actorId: input.credentialId,
    action: 'ESCALATION_ACCEPTED',
    subjectType: 'feedback_ticket',
    subjectId: ticket.id,
    metadata: {
      appId: input.appId,
      externalId: input.command.externalId,
      idempotencyKey: input.idempotencyKey,
      result: ticket.result,
    },
    requestCorrelationId: input.idempotencyKey,
    createdAt: acceptedAt,
  })
}

async function finalizeReceipt(
  tx: DbTransaction,
  receiptId: string,
  appId: string,
  ticket: PersistedTicket,
  acceptedAt: Date,
): Promise<IntakeResult> {
  const result: IntakeResult = {
    appId,
    ticketId: ticket.id,
    result: ticket.result,
    acceptedAt,
  }
  await tx.update(ingestReceipts).set({
    ticketId: ticket.id,
    result: ticket.result,
    responseSnapshot: {
      ...result,
      acceptedAt: acceptedAt.toISOString(),
    },
    updatedAt: acceptedAt,
  }).where(eq(ingestReceipts.id, receiptId))
  return result
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}
