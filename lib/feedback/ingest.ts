import { nanoid } from 'nanoid'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { timingSafeEqual } from 'node:crypto'
import { getDb } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'
import type {
  FeedbackKind,
  FeedbackPriority,
  FeedbackStatus,
} from '@/lib/feedback/status'

const feedbackStatusValues = [
  'NEW',
  'IN_REVIEW',
  'BACKLOG',
  'PLANNED',
  'IN_PROGRESS',
  'FIXED',
  'SHIPPED',
  'DECLINED',
  'CLOSED',
] as const

const feedbackPriorityValues = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

function normalizeToken(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

export function normalizeFeedbackStatus(value: unknown): FeedbackStatus | undefined {
  if (typeof value !== 'string') return undefined

  const normalized = normalizeToken(value)
  const aliases: Record<string, FeedbackStatus> = {
    AI_BATCH_FIX: 'IN_PROGRESS',
    A_FAIRE: 'NEW',
    BACKLOG: 'BACKLOG',
    CLOSED: 'CLOSED',
    CLOTURE: 'CLOSED',
    CORRIGE: 'FIXED',
    DECLINED: 'DECLINED',
    DELIVERED: 'SHIPPED',
    DONE: 'FIXED',
    DOING: 'IN_PROGRESS',
    EN_COURS: 'IN_PROGRESS',
    EN_REVUE: 'IN_REVIEW',
    FIXED: 'FIXED',
    IN_PROGRESS: 'IN_PROGRESS',
    IN_REVIEW: 'IN_REVIEW',
    NEW: 'NEW',
    NOT_STARTED: 'NEW',
    OPEN: 'NEW',
    PLANNED: 'PLANNED',
    REFUSE: 'DECLINED',
    REJECTED: 'DECLINED',
    RELEASED: 'SHIPPED',
    RESOLVED: 'FIXED',
    SHIPPED: 'SHIPPED',
    STARTED: 'IN_PROGRESS',
    TODO: 'NEW',
    TO_DO: 'NEW',
    WONT_FIX: 'DECLINED',
  }

  return aliases[normalized]
}

function normalizeFeedbackPriority(value: unknown): FeedbackPriority | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeToken(value)
  const aliases: Record<string, FeedbackPriority> = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    NORMAL: 'MEDIUM',
    HIGH: 'HIGH',
    URGENT: 'URGENT',
    CRITICAL: 'URGENT',
  }

  return aliases[normalized]
}

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
      .preprocess(
        (value) => normalizeFeedbackStatus(value) ?? value,
        z.enum(feedbackStatusValues).default('NEW'),
      ),
    priority: z
      .preprocess(
        (value) => normalizeFeedbackPriority(value) ?? value,
        z.enum(feedbackPriorityValues).default('MEDIUM'),
      ),
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
  const sourceTicketUrl = normalizeSourceTicketUrl(
    ticket.url,
    payload.app.baseUrl ?? null,
  )
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
    url: sourceTicketUrl,
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

export function getIngestTokenForApp(
  appSlug: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const tokenMapJson = env.SUPPORT_TOWER_INGEST_TOKENS_JSON?.trim()

  if (tokenMapJson) {
    const parsed = JSON.parse(tokenMapJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('SUPPORT_TOWER_INGEST_TOKENS_JSON must be a JSON object')
    }

    const value = (parsed as Record<string, unknown>)[appSlug]
    return typeof value === 'string' && value.trim() ? value : null
  }

  return env.SUPPORT_TOWER_INGEST_TOKEN?.trim() || null
}

export function constantTimeTokenEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)

  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}
