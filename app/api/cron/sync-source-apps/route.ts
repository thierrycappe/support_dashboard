import { NextResponse } from 'next/server'
import { hasDatabaseUrl } from '@/lib/db'
import {
  listConfiguredPullSlugs,
  pullSourceApp,
  type PullSourceAppResult,
} from '@/lib/feedback/source-pull'

export const dynamic = 'force-dynamic'

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return process.env.NODE_ENV !== 'production'
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 503 },
    )
  }

  const slugs = listConfiguredPullSlugs()
  const results: PullSourceAppResult[] = []
  for (const slug of slugs) {
    results.push(await pullSourceApp({ appSlug: slug }))
  }

  return NextResponse.json({
    ok: true,
    apps: results,
    generatedAt: new Date().toISOString(),
  })
}
