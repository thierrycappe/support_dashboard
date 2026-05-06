import { describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '@/lib/feedback/dashboard'
import {
  buildDailyReportPushoverMessage,
  sendDailyOpenTicketReport,
} from '@/lib/notifications/daily-report'

const dashboardData: DashboardData = {
  databaseConfigured: true,
  apps: [
    {
      id: 'app-1',
      slug: 'csm',
      name: 'Centre de Services Manutan',
      environment: 'production',
      status: 'ACTIVE',
      lastSeenAt: new Date('2026-05-06T08:00:00.000Z'),
      openCount: 2,
    },
    {
      id: 'app-2',
      slug: 'casal-track',
      name: 'Casal Track',
      environment: 'production',
      status: 'ACTIVE',
      lastSeenAt: new Date('2026-05-06T08:00:00.000Z'),
      openCount: 1,
    },
  ],
  tickets: [
    {
      id: 'ticket-1',
      externalId: 'external-1',
      appSlug: 'csm',
      appName: 'Centre de Services Manutan',
      kind: 'BUG',
      status: 'NEW',
      priority: 'URGENT',
      title: 'Checkout button is blocked',
      url: 'https://csm-track-zeta.vercel.app/admin/bugs/external-1',
      reporterEmail: 'thierry@example.com',
      updatedAt: new Date('2026-05-06T08:00:00.000Z'),
    },
    {
      id: 'ticket-2',
      externalId: 'external-2',
      appSlug: 'csm',
      appName: 'Centre de Services Manutan',
      kind: 'EVOLUTION',
      status: 'PLANNED',
      priority: 'MEDIUM',
      title: 'Add export filters',
      url: null,
      reporterEmail: null,
      updatedAt: new Date('2026-05-06T07:00:00.000Z'),
    },
    {
      id: 'ticket-3',
      externalId: 'external-3',
      appSlug: 'casal-track',
      appName: 'Casal Track',
      kind: 'BUG',
      status: 'BACKLOG',
      priority: 'LOW',
      title: 'Logo has old spacing',
      url: null,
      reporterEmail: null,
      updatedAt: new Date('2026-05-06T06:00:00.000Z'),
    },
  ],
  totals: {
    open: 3,
    bugs: 2,
    evolutions: 1,
    urgent: 1,
  },
}

describe('daily report notifications', () => {
  it('builds a digest with totals, apps, and top queue', () => {
    const message = buildDailyReportPushoverMessage(dashboardData, {
      SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
    })

    expect(message.title).toBe('Support Tower daily report: 3 open')
    expect(message.priority).toBe(1)
    expect(message.url).toBe('https://support.example.com')
    expect(message.message).toContain('3 open tickets: 2 bugs, 1 evolutions, 1 urgent.')
    expect(message.message).toContain('Centre de Services Manutan: 2')
    expect(message.message).toContain('Casal Track: 1')
    expect(message.message).toContain(
      'URGENT Centre de Services Manutan: Checkout button is blocked (NEW)',
    )
  })

  it('builds a quiet report when no tickets are open', () => {
    const message = buildDailyReportPushoverMessage({
      databaseConfigured: true,
      apps: [],
      tickets: [],
      totals: { open: 0, bugs: 0, evolutions: 0, urgent: 0 },
    })

    expect(message.priority).toBe(-1)
    expect(message.message).toContain('No open support tickets')
  })

  it('sends the digest when Pushover is configured', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init
      return new Response('{}', { status: 200 })
    })

    const result = await sendDailyOpenTicketReport({
      data: dashboardData,
      env: {
        PUSHOVER_APP_TOKEN: 'app-token',
        PUSHOVER_USER_KEY: 'user-key',
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
      fetchImpl,
    })

    expect(result).toBe('sent')
    const body = requestInit?.body as URLSearchParams
    expect(body.get('title')).toBe('Support Tower daily report: 3 open')
    expect(body.get('url')).toBe('https://support.example.com')
  })
})
