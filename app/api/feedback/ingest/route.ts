import { NextResponse } from 'next/server'
import {
  feedbackIngestSchema,
  getBearerToken,
  ingestFeedbackTicket,
} from '@/lib/feedback/ingest'
import { hasDatabaseUrl } from '@/lib/db'

export async function POST(request: Request) {
  const expectedToken = process.env.SUPPORT_TOWER_INGEST_TOKEN
  if (!expectedToken) {
    return NextResponse.json(
      { error: 'SUPPORT_TOWER_INGEST_TOKEN is not configured' },
      { status: 503 },
    )
  }

  const token = getBearerToken(request.headers)
  if (token !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 503 },
    )
  }

  const json = await request.json().catch(() => null)
  const parsed = feedbackIngestSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid feedback payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await ingestFeedbackTicket(parsed.data)
  return NextResponse.json(result, { status: result.created ? 201 : 200 })
}
