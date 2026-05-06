import { NextResponse } from 'next/server'
import { getDashboardData } from '@/lib/feedback/dashboard'
import { sendDailyOpenTicketReport } from '@/lib/notifications/daily-report'

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

  const data = await getDashboardData()
  const notification = await sendDailyOpenTicketReport({ data })

  return NextResponse.json({
    ok: true,
    notification,
    openTickets: data.totals.open,
    generatedAt: new Date().toISOString(),
  })
}
