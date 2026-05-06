import { nanoid } from 'nanoid'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import type {
  FeedbackKind,
  FeedbackPriority,
  FeedbackStatus,
} from '@/lib/feedback/status'

const transcriptMessageSchema = z.object({
  role: z.string().min(1),
  content: z.string().min(1),
})

export const feedbackIngestSchema = z.object({
  app: z.object({
    slug: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1).max(160),
    baseUrl: z.string().url().optional().nullable(),
    environment: z.string().min(1).max(80).default('production'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  ticket: z.object({
    externalId: z.string().min(1).max(200),
    kind: z.enum(['BUG', 'EVOLUTION']).default('BUG'),
    status: z
      .enum([
        'NEW',
        'IN_REVIEW',
        'BACKLOG',
        'PLANNED',
        'IN_PROGRESS',
        'FIXED',
        'SHIPPED',
        'DECLINED',
        'CLOSED',
      ])
      .default('NEW'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    title: z.string().min(1).max(240),
    description: z.string().min(1),
    reporterName: z.string().max(200).optional().nullable(),
    reporterEmail: z.string().email().optional().nullable(),
    reporterId: z.string().max(200).optional().nullable(),
    url: z.string().url().optional().nullable(),
    browserInfo: z.string().max(1000).optional().nullable(),
    markdownSpec: z.string().optional().nullable(),
    transcript: z.array(transcriptMessageSchema).optional().nullable(),
    remoteCreatedAt: z.string().datetime().optional().nullable(),
    remoteUpdatedAt: z.string().datetime().optional().nullable(),
    lastStatusChangeAt: z.string().datetime().optional().nullable(),
  }),
})

export type FeedbackIngestPayload = z.infer<typeof feedbackIngestSchema>

export interface IngestResult {
  appId: string
  ticketId: string
  created: boolean
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

export async function ingestFeedbackTicket(
  payload: FeedbackIngestPayload,
): Promise<IngestResult> {
  const db = getDb()
  const now = new Date()
  const appRows = await db
    .select({ id: sourceApps.id })
    .from(sourceApps)
    .where(eq(sourceApps.slug, payload.app.slug))
    .limit(1)

  const appId = appRows[0]?.id ?? nanoid()

  if (appRows.length === 0) {
    await db.insert(sourceApps).values({
      id: appId,
      slug: payload.app.slug,
      name: payload.app.name,
      baseUrl: payload.app.baseUrl ?? null,
      environment: payload.app.environment,
      status: 'ACTIVE',
      lastSeenAt: now,
      metadata: payload.app.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    await db
      .update(sourceApps)
      .set({
        name: payload.app.name,
        baseUrl: payload.app.baseUrl ?? null,
        environment: payload.app.environment,
        lastSeenAt: now,
        metadata: payload.app.metadata ?? null,
        updatedAt: now,
      })
      .where(eq(sourceApps.id, appId))
  }

  const existingRows = await db
    .select({ id: feedbackTickets.id })
    .from(feedbackTickets)
    .where(
      and(
        eq(feedbackTickets.sourceAppId, appId),
        eq(feedbackTickets.externalId, payload.ticket.externalId),
      ),
    )
    .limit(1)

  const ticketId = existingRows[0]?.id ?? nanoid()
  const ticket = payload.ticket
  const values = {
    sourceAppId: appId,
    externalId: ticket.externalId,
    kind: ticket.kind as FeedbackKind,
    status: ticket.status as FeedbackStatus,
    priority: ticket.priority as FeedbackPriority,
    title: ticket.title,
    description: ticket.description,
    reporterName: ticket.reporterName ?? null,
    reporterEmail: ticket.reporterEmail ?? null,
    reporterId: ticket.reporterId ?? null,
    url: ticket.url ?? null,
    browserInfo: ticket.browserInfo ?? null,
    markdownSpec: ticket.markdownSpec ?? null,
    transcript: ticket.transcript ?? null,
    rawPayload: payload,
    remoteCreatedAt: toDate(ticket.remoteCreatedAt),
    remoteUpdatedAt: toDate(ticket.remoteUpdatedAt),
    lastStatusChangeAt: toDate(ticket.lastStatusChangeAt),
    lastSyncedAt: now,
    updatedAt: now,
  }

  if (existingRows.length === 0) {
    await db.insert(feedbackTickets).values({
      id: ticketId,
      ...values,
      createdAt: now,
    })
    return { appId, ticketId, created: true }
  }

  await db.update(feedbackTickets).set(values).where(eq(feedbackTickets.id, ticketId))
  return { appId, ticketId, created: false }
}

export function getBearerToken(headers: Headers): string | null {
  const value = headers.get('authorization')
  if (!value?.startsWith('Bearer ')) return null
  return value.slice('Bearer '.length).trim()
}
