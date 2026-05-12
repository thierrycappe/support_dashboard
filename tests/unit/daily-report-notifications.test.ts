import { describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '@/lib/feedback/dashboard'
import {
  buildDailyReportEmail,
  getDailyReportEmailConfig,
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
      lastSyncedAt: new Date('2026-05-06T08:00:00.000Z'),
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
      lastSyncedAt: new Date('2026-05-06T07:00:00.000Z'),
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
      lastSyncedAt: new Date('2026-05-06T06:00:00.000Z'),
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
  it('resolves Resend config from email env vars and admin fallback', () => {
    expect(
      getDailyReportEmailConfig({
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'Support Tower <support@example.com>',
        SUPPORT_DASHBOARD_ADMIN_EMAILS:
          'thierry@example.com, support@example.com',
      }),
    ).toEqual({
      apiKey: 're_test',
      from: 'Support Tower <support@example.com>',
      to: ['thierry@example.com', 'support@example.com'],
    })
  })

  it('builds an email digest with totals, apps, and top queue', () => {
    const email = buildDailyReportEmail(
      dashboardData,
      {
        from: 'Support Tower <support@example.com>',
        to: ['thierry@example.com'],
      },
      {
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
    )

    expect(email.subject).toBe('Support Tower daily report: 3 open')
    expect(email.from).toBe('Support Tower <support@example.com>')
    expect(email.to).toEqual(['thierry@example.com'])
    expect(email.text).toContain('3 open tickets: 2 bugs, 1 evolutions, 1 urgent.')
    expect(email.text).toContain('Centre de Services Manutan: 2')
    expect(email.text).toContain('Casal Track: 1')
    expect(email.text).toContain(
      'URGENT Centre de Services Manutan: Checkout button is blocked (NEW)',
    )
    expect(email.html).toContain('Open Support Tower')
  })

  it('builds a quiet email report when no tickets are open', () => {
    const email = buildDailyReportEmail(
      {
        databaseConfigured: true,
        apps: [],
        tickets: [],
        totals: { open: 0, bugs: 0, evolutions: 0, urgent: 0 },
      },
      {
        from: 'Support Tower <support@example.com>',
        to: ['thierry@example.com'],
      },
      {
      SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
    )

    expect(email.subject).toBe('Support Tower daily report: 0 open')
    expect(email.text).toContain('No open support tickets')
  })

  it('sends the digest through Resend when configured', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init
      return new Response('{}', { status: 200 })
    })

    const result = await sendDailyOpenTicketReport({
      data: dashboardData,
      env: {
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'Support Tower <support@example.com>',
        SUPPORT_DASHBOARD_ADMIN_EMAILS: 'thierry@example.com',
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
      fetchImpl,
    })

    expect(result).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(requestInit?.headers).toEqual({
      Authorization: 'Bearer re_test',
      'Content-Type': 'application/json',
    })
    const body = JSON.parse(String(requestInit?.body))
    expect(body.subject).toBe('Support Tower daily report: 3 open')
    expect(body.to).toEqual(['thierry@example.com'])
  })
})
