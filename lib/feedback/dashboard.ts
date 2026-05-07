import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'
import { OPEN_STATUSES, type FeedbackStatus } from '@/lib/feedback/status'

export interface DashboardData {
  databaseConfigured: boolean
  apps: Array<{
    id: string
    slug: string
    name: string
    environment: string
    status: string
    lastSeenAt: Date | null
    openCount: number
  }>
  tickets: Array<{
    id: string
    externalId: string
    appSlug: string
    appName: string
    kind: string
    status: string
    priority: string
    title: string
    url: string | null
    reporterEmail: string | null
    updatedAt: Date
  }>
  totals: {
    open: number
    bugs: number
    evolutions: number
    urgent: number
  }
}

export interface DashboardTotals {
  open: number
  bugs: number
  evolutions: number
  urgent: number
}

export function normalizeDashboardTotals(
  row: Partial<Record<keyof DashboardTotals, number | string | null>> | undefined,
): DashboardTotals {
  return {
    open: Number(row?.open ?? 0),
    bugs: Number(row?.bugs ?? 0),
    evolutions: Number(row?.evolutions ?? 0),
    urgent: Number(row?.urgent ?? 0),
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  if (!hasDatabaseUrl()) {
    return {
      databaseConfigured: false,
      apps: [],
      tickets: [],
      totals: { open: 0, bugs: 0, evolutions: 0, urgent: 0 },
    }
  }

  const db = getDb()
  const openStatuses = OPEN_STATUSES as [FeedbackStatus, ...FeedbackStatus[]]

  const [totalsRow] = await db
    .select({
      open: sql<number>`count(*)::int`,
      bugs: sql<number>`count(*) filter (where ${feedbackTickets.kind} = 'BUG')::int`,
      evolutions: sql<number>`count(*) filter (where ${feedbackTickets.kind} = 'EVOLUTION')::int`,
      urgent: sql<number>`count(*) filter (where ${feedbackTickets.priority} = 'URGENT')::int`,
    })
    .from(feedbackTickets)
    .where(inArray(feedbackTickets.status, openStatuses))

  const tickets = await db
    .select({
      id: feedbackTickets.id,
      externalId: feedbackTickets.externalId,
      appSlug: sourceApps.slug,
      appName: sourceApps.name,
      kind: feedbackTickets.kind,
      status: feedbackTickets.status,
      priority: feedbackTickets.priority,
      title: feedbackTickets.title,
      url: feedbackTickets.url,
      appBaseUrl: sourceApps.baseUrl,
      reporterEmail: feedbackTickets.reporterEmail,
      updatedAt: feedbackTickets.updatedAt,
    })
    .from(feedbackTickets)
    .innerJoin(sourceApps, eq(feedbackTickets.sourceAppId, sourceApps.id))
    .where(inArray(feedbackTickets.status, openStatuses))
    .orderBy(desc(feedbackTickets.updatedAt))
    .limit(100)

  const appRows = await db
    .select({
      id: sourceApps.id,
      slug: sourceApps.slug,
      name: sourceApps.name,
      environment: sourceApps.environment,
      status: sourceApps.status,
      lastSeenAt: sourceApps.lastSeenAt,
      openCount: sql<number>`count(${feedbackTickets.id})::int`,
    })
    .from(sourceApps)
    .leftJoin(
      feedbackTickets,
      and(
        eq(sourceApps.id, feedbackTickets.sourceAppId),
        inArray(feedbackTickets.status, openStatuses),
      ),
    )
    .groupBy(
      sourceApps.id,
      sourceApps.slug,
      sourceApps.name,
      sourceApps.environment,
      sourceApps.status,
      sourceApps.lastSeenAt,
    )
    .orderBy(desc(sql<number>`count(${feedbackTickets.id})`))

  return {
    databaseConfigured: true,
    apps: appRows,
    tickets: tickets.map(({ appBaseUrl, ...ticket }) => ({
      ...ticket,
      url: normalizeSourceTicketUrl(ticket.url, appBaseUrl, ticket.appSlug),
    })),
    totals: normalizeDashboardTotals(totalsRow),
  }
}
