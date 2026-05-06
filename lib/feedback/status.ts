import type { feedbackKind, feedbackPriority, feedbackStatus } from '@/lib/db/schema'

export type FeedbackKind = (typeof feedbackKind.enumValues)[number]
export type FeedbackPriority = (typeof feedbackPriority.enumValues)[number]
export type FeedbackStatus = (typeof feedbackStatus.enumValues)[number]

export const OPEN_STATUSES: FeedbackStatus[] = [
  'NEW',
  'IN_REVIEW',
  'BACKLOG',
  'PLANNED',
  'IN_PROGRESS',
]

export const TERMINAL_STATUSES: FeedbackStatus[] = [
  'FIXED',
  'SHIPPED',
  'DECLINED',
  'CLOSED',
]

export function isOpenStatus(status: FeedbackStatus): boolean {
  return OPEN_STATUSES.includes(status)
}

export function visibleStatusLabel(status: FeedbackStatus): string {
  const labels: Record<FeedbackStatus, string> = {
    NEW: 'New',
    IN_REVIEW: 'In review',
    BACKLOG: 'Backlog',
    PLANNED: 'Planned',
    IN_PROGRESS: 'In progress',
    FIXED: 'Fixed',
    SHIPPED: 'Shipped',
    DECLINED: 'Declined',
    CLOSED: 'Closed',
  }

  return labels[status]
}

export function kindLabel(kind: FeedbackKind): string {
  return kind === 'BUG' ? 'Bug' : 'Evolution'
}

export function priorityWeight(priority: FeedbackPriority): number {
  const weights: Record<FeedbackPriority, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    URGENT: 4,
  }

  return weights[priority]
}
