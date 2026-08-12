import { NextResponse } from 'next/server'
import {
  feedbackIngestSchema,
  getBearerToken,
  getConfiguredAppSlugForIngestToken,
} from '@/lib/feedback/ingest'
import { hasDatabaseUrl } from '@/lib/db'
import { acceptLegacyPayload, legacyResult } from '@/lib/escalations/legacy'

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

  const authoritativeAppSlug = getConfiguredAppSlugForIngestToken(token)
  if (!authoritativeAppSlug) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 503 },
    )
  }

  const result = legacyResult(await acceptLegacyPayload({
    payload: parsed.data,
    authoritativeAppSlug,
    idempotencyKey: request.headers.get('idempotency-key'),
  }))

  return NextResponse.json(result, { status: result.created ? 201 : 200 })
}
