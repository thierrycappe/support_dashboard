import { NextResponse } from 'next/server'
import { drainImmediateDeliveries } from '@/lib/delivery/worker'
import { drainExpiredAssertionReplays } from '@/lib/service-auth/maintenance'

export const dynamic = 'force-dynamic'

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [delivery, assertionReplayCleanup] = await Promise.all([
    drainImmediateDeliveries(),
    drainExpiredAssertionReplays(),
  ])
  return NextResponse.json({ ...delivery, assertionReplayCleanup })
}
