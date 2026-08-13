import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ hasDatabaseUrl: () => true }))
vi.mock('@/lib/escalations/legacy', () => ({
  acceptLegacyPayload: vi.fn(async () => ({ appId: 'app-1', ticketId: 'ticket-1', result: 'created', acceptedAt: new Date() })),
  legacyResult: () => ({ appId: 'app-1', ticketId: 'ticket-1', created: true }),
}))
const inlinePushoverTransport = vi.fn()
vi.mock('@/lib/notifications/pushover', () => ({ sendPushoverMessage: inlinePushoverTransport }))

import { POST } from '@/app/api/feedback/ingest/route'
import { acceptLegacyPayload } from '@/lib/escalations/legacy'

const payload = { app: { slug: 'casal-track', name: 'Casal Track' }, ticket: { externalId: 'ct_42', title: 'Broken', description: 'Details' } }

describe('legacy ingest route', () => {
  beforeEach(() => { process.env.SUPPORT_TOWER_INGEST_TOKEN_CASAL_TRACK = 'casal-token'; vi.clearAllMocks() })
  it('uses the configured slug authority and never calls a provider inline', async () => {
    const response = await POST(new Request('https://tower/api/feedback/ingest', { method: 'POST', headers: { authorization: 'Bearer casal-token', 'content-type': 'application/json', 'idempotency-key': 'caller-key' }, body: JSON.stringify(payload) }))
    expect(response.status).toBe(201)
    expect(acceptLegacyPayload).toHaveBeenCalledWith(expect.objectContaining({ authoritativeAppSlug: 'casal-track', idempotencyKey: 'caller-key' }))
    expect(inlinePushoverTransport).not.toHaveBeenCalled()
  })

  it('uses the configured token identity instead of trusting the payload slug', async () => {
    process.env.SUPPORT_TOWER_INGEST_TOKEN_OTHER_APP = 'other-token'
    const response = await POST(new Request('https://tower/api/feedback/ingest', {
      method: 'POST',
      headers: { authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Source app identity mismatch' })
    expect(acceptLegacyPayload).not.toHaveBeenCalled()
  })
})
