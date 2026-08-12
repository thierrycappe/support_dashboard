import type { FeedbackPriority, FeedbackStatus } from '@/lib/feedback/status'
import type { EscalationQueueInput } from '@/lib/escalations/queries'

const priorities = new Set<FeedbackPriority>(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
const statuses = new Set<FeedbackStatus>(['NEW', 'IN_REVIEW', 'BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FIXED', 'SHIPPED', 'DECLINED', 'CLOSED'])

export type EscalationSearchParams = Record<string, string | string[] | undefined>
export interface EscalationCursor { updatedAt: Date; id: string }

export function parseEscalationSearchParams(params: EscalationSearchParams): EscalationQueueInput {
  const input: EscalationQueueInput = { limit: 50 }
  const search = scalar(params.search)?.trim()
  const appId = scalar(params.app)?.trim()
  const priority = scalar(params.priority)
  const status = scalar(params.status)
  const cursor = scalar(params.cursor)
  if (search) input.search = search.slice(0, 200)
  if (appId) input.appId = appId.slice(0, 200)
  if (priority && priorities.has(priority as FeedbackPriority)) input.priority = priority as FeedbackPriority
  if (status && statuses.has(status as FeedbackStatus)) input.status = status as FeedbackStatus
  if (cursor && decodeEscalationCursor(cursor)) input.cursor = cursor
  return input
}

export function encodeEscalationCursor(cursor: EscalationCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, t: cursor.updatedAt.toISOString(), i: cursor.id })).toString('base64url')
}

export function decodeEscalationCursor(value: string): EscalationCursor | null {
  try {
    if (value.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null
    const record = decoded as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'i,t,v' || record.v !== 1 || typeof record.t !== 'string' || typeof record.i !== 'string' || !record.i) return null
    const updatedAt = new Date(record.t)
    if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== record.t) return null
    return { updatedAt, id: record.i }
  } catch { return null }
}

export function buildEscalationQueueHref(input: EscalationQueueInput, cursor?: string | null): string {
  const params = new URLSearchParams()
  if (input.search) params.set('search', input.search)
  if (input.appId) params.set('app', input.appId)
  if (input.priority) params.set('priority', input.priority)
  if (input.status) params.set('status', input.status)
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return query ? `/?${query}` : '/'
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
