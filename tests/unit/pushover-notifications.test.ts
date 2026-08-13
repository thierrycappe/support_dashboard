import { describe, expect, it, vi } from 'vitest'
import {
  getPushoverConfig,
  getTowerPublicUrl,
  sendPushoverMessage,
} from '@/lib/notifications/pushover'

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

  it('sends the already-rendered durable delivery message', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init
      return new Response('{}', { status: 200 })
    })

    await sendPushoverMessage({
      config: { appToken: 'app-token', userKey: 'user-key' },
      message: { title: 'New alert', message: 'Stored outbox payload', priority: 0 },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.pushover.net/1/messages.json',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = requestInit?.body as URLSearchParams
    expect(body.get('token')).toBe('app-token')
    expect(body.get('user')).toBe('user-key')
    expect(body.get('message')).toBe('Stored outbox payload')
  })
})
