import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import {
  fetchTicketsFromSource,
  getSourceAppPullConfig,
} from '@/lib/feedback/source-pull'
import { acceptLegacyPayload, legacyResult } from '@/lib/escalations/legacy'

export const dynamic = 'force-dynamic'
const REFRESH_FAILURE_MESSAGE = 'Source refresh could not be completed. Try again later.'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: REFRESH_FAILURE_MESSAGE }, { status: 503 })
  }

  const { id } = await params
  const db = getDb()
  const rows = await db
    .select({
      externalId: feedbackTickets.externalId,
      appSlug: sourceApps.slug,
    })
    .from(feedbackTickets)
    .innerJoin(sourceApps, eq(sourceApps.id, feedbackTickets.sourceAppId))
    .where(eq(feedbackTickets.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return NextResponse.json({ error: REFRESH_FAILURE_MESSAGE }, { status: 404 })
  }

  try {
    const config = getSourceAppPullConfig(row.appSlug)
    if (!config) return NextResponse.json({ error: REFRESH_FAILURE_MESSAGE }, { status: 503 })
    const tickets = await fetchTicketsFromSource({
      config,
      externalId: row.externalId,
    })
    const payload = tickets[0]
    if (tickets.length !== 1 || !payload || payload.app.slug !== row.appSlug || payload.ticket.externalId !== row.externalId) {
      return NextResponse.json({ error: REFRESH_FAILURE_MESSAGE }, { status: 502 })
    }
    const accepted = await acceptLegacyPayload({ payload, authoritativeAppSlug: row.appSlug })
    const result = legacyResult(accepted)
    return NextResponse.json({ ok: true, changed: accepted.result !== 'duplicate', ticketId: result.ticketId })
  } catch (error) {
    console.warn('Source refresh failed', { ticketId: id, appSlug: row.appSlug, errorType: error instanceof Error ? error.name : typeof error })
    return NextResponse.json({ error: REFRESH_FAILURE_MESSAGE }, { status: 502 })
  }
}
