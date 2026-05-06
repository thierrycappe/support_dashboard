import { NextResponse } from 'next/server'
import {
  constantTimeTokenEquals,
  feedbackIngestSchema,
  getBearerToken,
  getIngestTokenForApp,
  ingestFeedbackTicket,
} from '@/lib/feedback/ingest'
import { hasDatabaseUrl } from '@/lib/db'

export async function POST(request: Request) {
  const token = getBearerToken(request.headers)
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await request.json().catch(() => null)
  const parsed = feedbackIngestSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid feedback payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  let expectedToken: string | null
  try {
    expectedToken = getIngestTokenForApp(parsed.data.app.slug)
  } catch {
    return NextResponse.json(
      { error: 'SUPPORT_TOWER_INGEST_TOKENS_JSON is invalid' },
      { status: 503 },
    )
  }

  if (!expectedToken || !constantTimeTokenEquals(token, expectedToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 503 },
    )
  }

  const result = await ingestFeedbackTicket(parsed.data)
  return NextResponse.json(result, { status: result.created ? 201 : 200 })
}
