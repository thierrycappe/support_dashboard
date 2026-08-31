import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  normalizeFeedbackPriority,
  normalizeFeedbackStatus,
  type FeedbackIngestPayload,
} from '@/lib/feedback/ingest'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'
import type { FeedbackPriority, FeedbackStatus } from '@/lib/feedback/status'

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
] as const satisfies readonly FeedbackStatus[]

const feedbackPriorityValues = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const satisfies readonly FeedbackPriority[]

const transcriptMessageSchema = z
  .object({
    role: z.string().min(1),
    content: z.string().min(1),
  })
  .strict()

const triageSchema = z
  .object({
    ownerRef: z.string().min(1).max(200),
    ownerName: z.string().max(200).nullable(),
    escalatedAt: z.string().datetime(),
  })
  .strict()

const reporterSchema = z
  .object({
    name: z.string().max(200).nullable(),
    email: z.string().email().nullable(),
    sourceId: z.string().max(200).nullable(),
  })
  .strict()

export const MAX_ESCALATION_V1_BODY_BYTES = 256 * 1024

export interface EscalationCommand {
  externalId: string
  kind: 'BUG' | 'EVOLUTION'
  status: FeedbackStatus
  priority: FeedbackPriority
  title: string
  description: string
  sourceUrl: string | null
  triage: {
    ownerRef: string
    ownerName: string | null
    escalatedAt: string
  }
  reporter: {
    name: string | null
    email: string | null
    sourceId: string | null
  }
  browserInfo: string | null
  markdownSpec: string | null
  transcript: Array<{ role: string; content: string }> | null
  remoteCreatedAt: string | null
  remoteUpdatedAt: string | null
  metadata: Record<string, unknown>
}

export interface LegacyEscalationNormalization {
  authoritativeAppId: string
  command: EscalationCommand
}

const escalationV1PayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    externalId: z.string().min(1).max(200),
    classification: z.enum(['BUG', 'FEATURE_REQUEST']),
    status: z.enum(feedbackStatusValues),
    priority: z.enum(feedbackPriorityValues),
    title: z.string().min(1).max(240),
    description: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    triage: triageSchema,
    reporter: reporterSchema,
    browserInfo: z.string().max(1000).nullable(),
    markdownSpec: z.string().nullable(),
    transcript: z.array(transcriptMessageSchema).nullable(),
    remoteCreatedAt: z.string().datetime().nullable(),
    remoteUpdatedAt: z.string().datetime().nullable(),
    metadata: z.record(z.string(), z.json()),
  })
  .strict()
  .superRefine((payload, context) => {
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_ESCALATION_V1_BODY_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Escalation payload must not exceed ${MAX_ESCALATION_V1_BODY_BYTES} bytes`,
      })
    }
  })

export const escalationV1Schema = escalationV1PayloadSchema.transform(
  (payload): EscalationCommand => ({
    externalId: payload.externalId,
    kind: payload.classification === 'FEATURE_REQUEST' ? 'EVOLUTION' : 'BUG',
    status: payload.status,
    priority: payload.priority,
    title: payload.title,
    description: payload.description,
    sourceUrl: payload.sourceUrl,
    triage: payload.triage,
    reporter: payload.reporter,
    browserInfo: payload.browserInfo,
    markdownSpec: payload.markdownSpec,
    transcript: payload.transcript,
    remoteCreatedAt: payload.remoteCreatedAt,
    remoteUpdatedAt: payload.remoteUpdatedAt,
    metadata: payload.metadata,
  }),
)

export function legacyPayloadToCommand(
  payload: FeedbackIngestPayload,
  authoritativeAppId: string,
): LegacyEscalationNormalization {
  const ticket = payload.ticket
  const receivedAt = new Date().toISOString()

  return {
    authoritativeAppId,
    command: {
      externalId: ticket.externalId,
      kind: ticket.kind,
      status: normalizeFeedbackStatus(ticket.status) ?? ticket.status,
      priority: normalizeFeedbackPriority(ticket.priority) ?? ticket.priority,
      title: ticket.title,
      description: ticket.description,
      sourceUrl: normalizeSourceTicketUrl(
        ticket.url,
        payload.app.baseUrl,
        payload.app.slug,
      ),
      triage: {
        ownerRef: 'legacy-source',
        ownerName: null,
        escalatedAt: ticket.remoteUpdatedAt ?? receivedAt,
      },
      reporter: {
        name: ticket.reporterName ?? null,
        email: ticket.reporterEmail ?? null,
        sourceId: ticket.reporterId ?? null,
      },
      browserInfo: ticket.browserInfo ?? null,
      markdownSpec: ticket.markdownSpec ?? null,
      transcript: ticket.transcript ?? null,
      remoteCreatedAt: ticket.remoteCreatedAt ?? null,
      remoteUpdatedAt: ticket.remoteUpdatedAt ?? null,
      metadata: payload.app.metadata ?? {},
    },
  }
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort)

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nestedValue]) => [key, stableSort(nestedValue)]),
    )
  }

  return value
}

export function canonicalEscalationDigest(command: EscalationCommand): string {
  return createHash('sha256')
    .update(JSON.stringify(stableSort(command)))
    .digest('hex')
}
