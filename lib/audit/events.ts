import { nanoid } from 'nanoid'
import { getDb, type Db, type DbTransaction } from '@/lib/db'
import { auditEvents } from '@/lib/db/schema'

type AuditWriter = Db | DbTransaction

export interface AuditMutationContext {
  actorId: string
  correlationId: string
  reason: string
}

export interface AppendedAuditEvent {
  id: string
  actorId: string
  action: string
  subjectType: string
  subjectId: string | null
  requestCorrelationId: string
  createdAt: Date
}

export async function appendAuditEvent({
  db = getDb(),
  actorId,
  correlationId,
  reason,
  action,
  subjectType,
  subjectId,
  metadata = {},
  now = new Date(),
}: AuditMutationContext & {
  db?: AuditWriter
  action: string
  subjectType: string
  subjectId?: string | null
  metadata?: Record<string, unknown>
  now?: Date
}): Promise<AppendedAuditEvent> {
  const event = {
    id: nanoid(),
    actorId: required(actorId, 'actorId'),
    action: required(action, 'action'),
    subjectType: required(subjectType, 'subjectType'),
    subjectId: subjectId ?? null,
    requestCorrelationId: required(correlationId, 'correlationId'),
    createdAt: now,
  }
  const safeReason = required(reason, 'reason')
  assertSafeMetadata(metadata)

  await db.insert(auditEvents).values({
    id: event.id,
    actorType: 'USER',
    actorId: event.actorId,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    metadata: { ...metadata, reason: safeReason },
    requestCorrelationId: event.requestCorrelationId,
    createdAt: event.createdAt,
  })
  return event
}

function required(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${name} is required`)
  return trimmed
}

function assertSafeMetadata(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeMetadata(item)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'reason') {
      throw new Error('Reserved audit metadata is not allowed')
    }
    if (/(secret|token|password|cipher|plain|nonce|auth.?tag|config|key)/i.test(key)) {
      throw new Error('Sensitive audit metadata is not allowed')
    }
    assertSafeMetadata(nested)
  }
}
