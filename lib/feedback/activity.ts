import { and, desc, eq, gte, inArray, or } from 'drizzle-orm'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import {
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  type FeedbackStatus,
} from '@/lib/feedback/status'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const WEEK_COUNT = 8

type BugActivityRow = {
  id: string
  title: string
  appName: string
  status: FeedbackStatus
  remoteCreatedAt: Date | null
  remoteUpdatedAt: Date | null
  lastStatusChangeAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ActivityKpisData {
  databaseConfigured: boolean
  periodLabel: string
  summary: {
    resolvedBugs: string
    resolvedDelta: string
    medianCycle: string
    medianCycleDelta: string
    requesterWait: string
    requesterWaitDelta: string
    createdResolved: string
    createdResolvedDelta: string
  }
  throughputWeeks: Array<{
    label: string
    created: number
    resolved: number
    createdHeight: number
    resolvedHeight: number
  }>
  cyclePoints: Array<{
    id: string
    title: string
    appName: string
    days: number
    x: number
    y: number
  }>
  statusTimes: Array<{
    label: string
    value: number
    time: string
  }>
}

export function startOfUtcWeek(date: Date): Date {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const day = start.getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  start.setUTCDate(start.getUTCDate() - daysSinceMonday)
  return start
}

function formatWeekLabel(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatPeriodLabel(start: Date, end: Date): string {
  return `${formatWeekLabel(start)} - ${formatWeekLabel(new Date(end.getTime() - DAY_MS))}`
}

function formatCountDelta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'flat' : `+${current}`

  const percent = Math.round(((current - previous) / previous) * 100)
  if (percent === 0) return 'flat'
  return `${percent > 0 ? '+' : ''}${percent}%`
}

function formatSignedDurationDelta(currentMs: number | null, previousMs: number | null): string {
  if (currentMs === null || previousMs === null) return 'no baseline'

  const deltaDays = (currentMs - previousMs) / DAY_MS
  if (Math.abs(deltaDays) < 0.05) return 'flat'

  const sign = deltaDays > 0 ? '+' : ''
  if (Math.abs(deltaDays) < 1) {
    const hours = deltaDays * 24
    return `${hours > 0 ? '+' : ''}${hours.toFixed(1)}h`
  }

  return `${sign}${deltaDays.toFixed(1)}d`
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'n/a'

  const hours = ms / (60 * 60 * 1000)
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`

  const days = hours / 24
  return `${days.toFixed(days < 10 ? 1 : 0)}d`
}

function median(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)

  if (sorted.length === 0) return null

  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]

  return (sorted[middle - 1] + sorted[middle]) / 2
}

function firstTrackedDate(row: BugActivityRow): Date {
  return row.remoteCreatedAt ?? row.createdAt
}

function resolvedDate(row: BugActivityRow): Date | null {
  if (!TERMINAL_STATUSES.includes(row.status)) return null
  return row.lastStatusChangeAt ?? row.remoteUpdatedAt ?? row.updatedAt
}

function timeToResolution(row: BugActivityRow): number | null {
  const resolved = resolvedDate(row)
  if (!resolved) return null
  return resolved.getTime() - firstTrackedDate(row).getTime()
}

function requesterWait(row: BugActivityRow): number | null {
  if (!row.lastStatusChangeAt || row.status === 'NEW') return null
  return row.lastStatusChangeAt.getTime() - firstTrackedDate(row).getTime()
}

function inWindow(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false
  return date >= start && date < end
}

function makeWeekBuckets(now: Date) {
  const currentWeekStart = startOfUtcWeek(now)
  const firstStart = new Date(currentWeekStart.getTime() - (WEEK_COUNT - 1) * WEEK_MS)

  return Array.from({ length: WEEK_COUNT }, (_, index) => {
    const start = new Date(firstStart.getTime() + index * WEEK_MS)
    const end = new Date(start.getTime() + WEEK_MS)
    return { start, end, label: formatWeekLabel(start) }
  })
}

function emptyData(now: Date, databaseConfigured: boolean): ActivityKpisData {
  const weeks = makeWeekBuckets(now)
  return {
    databaseConfigured,
    periodLabel: formatPeriodLabel(weeks[0].start, weeks[weeks.length - 1].end),
    summary: {
      resolvedBugs: '0',
      resolvedDelta: 'flat',
      medianCycle: 'n/a',
      medianCycleDelta: 'no baseline',
      requesterWait: 'n/a',
      requesterWaitDelta: 'no baseline',
      createdResolved: '0',
      createdResolvedDelta: 'balanced',
    },
    throughputWeeks: weeks.map((week) => ({
      label: week.label,
      created: 0,
      resolved: 0,
      createdHeight: 0,
      resolvedHeight: 0,
    })),
    cyclePoints: [],
    statusTimes: [],
  }
}

export function buildActivityKpisData(
  rows: BugActivityRow[],
  openRows: BugActivityRow[],
  now = new Date(),
): ActivityKpisData {
  const weeks = makeWeekBuckets(now)
  const currentStart = weeks[0].start
  const currentEnd = weeks[weeks.length - 1].end
  const previousStart = new Date(currentStart.getTime() - WEEK_COUNT * WEEK_MS)

  const throughputWeeks = weeks.map((week) => {
    const created = rows.filter((row) =>
      inWindow(firstTrackedDate(row), week.start, week.end),
    ).length
    const resolved = rows.filter((row) =>
      inWindow(resolvedDate(row), week.start, week.end),
    ).length

    return {
      label: week.label,
      created,
      resolved,
      createdHeight: 0,
      resolvedHeight: 0,
    }
  })

  const maxThroughput = Math.max(
    1,
    ...throughputWeeks.flatMap((week) => [week.created, week.resolved]),
  )

  for (const week of throughputWeeks) {
    week.createdHeight = Math.round((week.created / maxThroughput) * 100)
    week.resolvedHeight = Math.round((week.resolved / maxThroughput) * 100)
  }

  const currentResolvedRows = rows.filter((row) =>
    inWindow(resolvedDate(row), currentStart, currentEnd),
  )
  const previousResolvedRows = rows.filter((row) =>
    inWindow(resolvedDate(row), previousStart, currentStart),
  )
  const currentCreatedCount = rows.filter((row) =>
    inWindow(firstTrackedDate(row), currentStart, currentEnd),
  ).length
  const previousCreatedCount = rows.filter((row) =>
    inWindow(firstTrackedDate(row), previousStart, currentStart),
  ).length

  const currentCycle = median(
    currentResolvedRows
      .map(timeToResolution)
      .filter((value): value is number => value !== null),
  )
  const previousCycle = median(
    previousResolvedRows
      .map(timeToResolution)
      .filter((value): value is number => value !== null),
  )

  const currentWait = median(
    rows
      .filter((row) => inWindow(row.lastStatusChangeAt, currentStart, currentEnd))
      .map(requesterWait)
      .filter((value): value is number => value !== null),
  )
  const previousWait = median(
    rows
      .filter((row) => inWindow(row.lastStatusChangeAt, previousStart, currentStart))
      .map(requesterWait)
      .filter((value): value is number => value !== null),
  )

  const createdResolved = currentResolvedRows.length - currentCreatedCount
  const previousCreatedResolved = previousResolvedRows.length - previousCreatedCount

  const slowestResolvedRows = currentResolvedRows
    .map((row) => ({ row, cycle: timeToResolution(row) }))
    .filter((item): item is { row: BugActivityRow; cycle: number } => item.cycle !== null)
    .sort((a, b) => b.cycle - a.cycle)
    .slice(0, 6)

  const maxCycle = Math.max(1, ...slowestResolvedRows.map((item) => item.cycle))
  const cyclePoints = slowestResolvedRows.map((item, index) => {
    const normalized = item.cycle / maxCycle
    return {
      id: item.row.id,
      title: item.row.title,
      appName: item.row.appName,
      days: item.cycle / DAY_MS,
      x: 14 + index * 14,
      y: Math.max(12, Math.round(normalized * 78)),
    }
  })

  const statusGroups = OPEN_STATUSES.map((status) => {
    const matchingRows = openRows.filter((row) => row.status === status)
    const durations = matchingRows
      .map((row) => now.getTime() - (row.lastStatusChangeAt ?? firstTrackedDate(row)).getTime())
      .filter((duration) => duration >= 0)
    const statusMedian = median(durations)

    return {
      label: status
        .toLowerCase()
        .split('_')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' '),
      rawValue: statusMedian ?? 0,
      time: formatDuration(statusMedian),
      count: matchingRows.length,
    }
  }).filter((item) => item.count > 0)

  const maxStatusTime = Math.max(1, ...statusGroups.map((item) => item.rawValue))
  const statusTimes = statusGroups.map((item) => ({
    label: item.label,
    value: Math.max(8, Math.round((item.rawValue / maxStatusTime) * 100)),
    time: item.time,
  }))

  return {
    databaseConfigured: true,
    periodLabel: formatPeriodLabel(currentStart, currentEnd),
    summary: {
      resolvedBugs: String(currentResolvedRows.length),
      resolvedDelta: formatCountDelta(currentResolvedRows.length, previousResolvedRows.length),
      medianCycle: formatDuration(currentCycle),
      medianCycleDelta: formatSignedDurationDelta(currentCycle, previousCycle),
      requesterWait: formatDuration(currentWait),
      requesterWaitDelta: formatSignedDurationDelta(currentWait, previousWait),
      createdResolved: `${createdResolved > 0 ? '+' : ''}${createdResolved}`,
      createdResolvedDelta:
        createdResolved === previousCreatedResolved
          ? 'flat'
          : `${createdResolved > previousCreatedResolved ? '+' : ''}${
              createdResolved - previousCreatedResolved
            } vs prior`,
    },
    throughputWeeks,
    cyclePoints,
    statusTimes,
  }
}

export async function getActivityKpisData(now = new Date()): Promise<ActivityKpisData> {
  if (!hasDatabaseUrl()) return emptyData(now, false)

  const db = getDb()
  const weeks = makeWeekBuckets(now)
  const currentStart = weeks[0].start
  const previousStart = new Date(currentStart.getTime() - WEEK_COUNT * WEEK_MS)
  const openStatuses = OPEN_STATUSES as [FeedbackStatus, ...FeedbackStatus[]]

  const baseSelection = {
    id: feedbackTickets.id,
    title: feedbackTickets.title,
    appName: sourceApps.name,
    status: feedbackTickets.status,
    remoteCreatedAt: feedbackTickets.remoteCreatedAt,
    remoteUpdatedAt: feedbackTickets.remoteUpdatedAt,
    lastStatusChangeAt: feedbackTickets.lastStatusChangeAt,
    createdAt: feedbackTickets.createdAt,
    updatedAt: feedbackTickets.updatedAt,
  }

  const rows = await db
    .select(baseSelection)
    .from(feedbackTickets)
    .innerJoin(sourceApps, eq(feedbackTickets.sourceAppId, sourceApps.id))
    .where(
      and(
        eq(feedbackTickets.kind, 'BUG'),
        or(
          gte(feedbackTickets.createdAt, previousStart),
          gte(feedbackTickets.remoteCreatedAt, previousStart),
          gte(feedbackTickets.lastStatusChangeAt, previousStart),
          gte(feedbackTickets.updatedAt, previousStart),
        ),
      ),
    )
    .orderBy(desc(feedbackTickets.updatedAt))
    .limit(2000)

  const openRows = await db
    .select(baseSelection)
    .from(feedbackTickets)
    .innerJoin(sourceApps, eq(feedbackTickets.sourceAppId, sourceApps.id))
    .where(and(eq(feedbackTickets.kind, 'BUG'), inArray(feedbackTickets.status, openStatuses)))
    .orderBy(desc(feedbackTickets.updatedAt))
    .limit(1000)

  return buildActivityKpisData(rows, openRows, now)
}
