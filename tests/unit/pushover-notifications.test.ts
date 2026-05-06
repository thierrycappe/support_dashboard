import { describe, expect, it, vi } from 'vitest'
import type { FeedbackIngestPayload } from '@/lib/feedback/ingest'
import {
  buildTicketCreatedPushoverMessage,
  getPushoverConfig,
  getTowerPublicUrl,
  notifyTicketCreated,
} from '@/lib/notifications/pushover'

const payload: FeedbackIngestPayload = {
  app: {
    slug: 'csm',
    name: 'Centre de Services Manutan',
    baseUrl: 'https://csm-track-zeta.vercel.app',
    environment: 'production',
  },
  ticket: {
    externalId: 'ticket-123',
    kind: 'BUG',
    status: 'NEW',
    priority: 'URGENT',
    title: 'Checkout button is blocked',
    description: 'The primary checkout button cannot be clicked.',
    reporterName: 'Thierry',
    reporterEmail: 'thierry@example.com',
    reporterId: 'user-1',
    url: 'https://csm-track-zeta.vercel.app/admin/bugs/ticket-123',
    browserInfo: 'Chrome',
    markdownSpec: null,
    transcript: null,
    remoteCreatedAt: '2026-05-06T10:00:00.000Z',
    remoteUpdatedAt: '2026-05-06T10:00:00.000Z',
    lastStatusChangeAt: '2026-05-06T10:00:00.000Z',
  },
}

const result = {
  appId: 'app-1',
  ticketId: 'tower-ticket-1',
  created: true,
}

describe('Pushover ticket notifications', () => {
  it('is disabled when Pushover env vars are missing', () => {
    expect(getPushoverConfig({})).toBeNull()
  })

  it('resolves the tower public URL from explicit env or Vercel env', () => {
    expect(
      getTowerPublicUrl({
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com/',
      }),
    ).toBe('https://support.example.com')

    expect(getTowerPublicUrl({ VERCEL_URL: 'support-dashboard.vercel.app' })).toBe(
      'https://support-dashboard.vercel.app',
    )
  })

  it('builds a new-ticket message linked to the tower ticket', () => {
    const message = buildTicketCreatedPushoverMessage(payload, result, {
      SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
    })

    expect(message.title).toBe('New support ticket: Checkout button is blocked')
    expect(message.priority).toBe(1)
    expect(message.message).toContain('BUG - URGENT - NEW')
    expect(message.message).toContain('App: Centre de Services Manutan')
    expect(message.message).toContain('Reporter: thierry@example.com')
    expect(message.message).toContain(
      'Source: https://csm-track-zeta.vercel.app/admin/bugs/ticket-123',
    )
    expect(message.url).toBe('https://support.example.com/feedback/tower-ticket-1')
    expect(message.url_title).toBe('Open in Support Tower')
  })

  it('sends a Pushover request when configured', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init
      return new Response('{}', { status: 200 })
    })

    const status = await notifyTicketCreated({
      payload,
      result,
      env: {
        PUSHOVER_APP_TOKEN: 'app-token',
        PUSHOVER_USER_KEY: 'user-key',
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
      fetchImpl,
    })

    expect(status).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.pushover.net/1/messages.json',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = requestInit?.body as URLSearchParams
    expect(body.get('token')).toBe('app-token')
    expect(body.get('user')).toBe('user-key')
    expect(body.get('url')).toBe('https://support.example.com/feedback/tower-ticket-1')
  })

  it('logs and returns failed without throwing when Pushover rejects', async () => {
    const logger = { warn: vi.fn() }
    const fetchImpl = vi.fn(async () => new Response('bad token', { status: 400 }))

    const status = await notifyTicketCreated({
      payload,
      result,
      env: {
        PUSHOVER_APP_TOKEN: 'app-token',
        PUSHOVER_USER_KEY: 'user-key',
      },
      fetchImpl,
      logger,
    })

    expect(status).toBe('failed')
    expect(logger.warn).toHaveBeenCalledWith(
      'Support tower Pushover notification failed',
      expect.objectContaining({ status: 400, ticketId: 'tower-ticket-1' }),
    )
  })
})
