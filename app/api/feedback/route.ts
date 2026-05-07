import { desc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'
import { OPEN_STATUSES, type FeedbackStatus } from '@/lib/feedback/status'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 })
  }

  const db = getDb()
  const rows = await db
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
    .where(inArray(feedbackTickets.status, OPEN_STATUSES as [FeedbackStatus, ...FeedbackStatus[]]))
    .orderBy(desc(feedbackTickets.updatedAt))

  return NextResponse.json({
    tickets: rows.map(({ appBaseUrl, ...ticket }) => ({
      ...ticket,
      url: normalizeSourceTicketUrl(ticket.url, appBaseUrl, ticket.appSlug),
    })),
  })
}
