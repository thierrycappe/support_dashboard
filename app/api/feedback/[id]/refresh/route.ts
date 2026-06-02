import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import {
  fetchTicketsFromSource,
  getSourceAppPullConfig,
} from '@/lib/feedback/source-pull'
import { ingestFeedbackTicket } from '@/lib/feedback/ingest'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 503 },
    )
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
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  const config = getSourceAppPullConfig(row.appSlug)
  if (!config) {
    return NextResponse.json(
      { error: `No pull endpoint configured for app "${row.appSlug}"` },
      { status: 503 },
    )
  }

  let tickets
  try {
    tickets = await fetchTicketsFromSource({
      config,
      externalId: row.externalId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Source pull failed: ${message}` },
      { status: 502 },
    )
  }

  const payload = tickets[0]
  if (!payload) {
    return NextResponse.json(
      { error: 'Source app returned no ticket for that externalId' },
      { status: 404 },
    )
  }

  const result = await ingestFeedbackTicket(payload)
  return NextResponse.json({
    ok: true,
    refreshed: true,
    ticketId: result.ticketId,
    status: payload.ticket.status,
  })
}
