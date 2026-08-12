// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), hasDatabaseUrl: vi.fn(), getDb: vi.fn(), getSourceAppPullConfig: vi.fn(),
  fetchTicketsFromSource: vi.fn(), acceptLegacyPayload: vi.fn(), legacyResult: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/db', () => ({ hasDatabaseUrl: mocks.hasDatabaseUrl, getDb: mocks.getDb }))
vi.mock('@/lib/feedback/source-pull', () => ({ getSourceAppPullConfig: mocks.getSourceAppPullConfig, fetchTicketsFromSource: mocks.fetchTicketsFromSource }))
vi.mock('@/lib/escalations/legacy', () => ({ acceptLegacyPayload: mocks.acceptLegacyPayload, legacyResult: mocks.legacyResult }))

import { POST } from '@/app/api/feedback/[id]/refresh/route'

const refreshFailure = 'Source refresh could not be completed. Try again later.'

describe('feedback source refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: 'support-1' } })
    mocks.hasDatabaseUrl.mockReturnValue(true)
    mocks.getDb.mockReturnValue({
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ externalId: 'ATLAS-42', appSlug: 'atlas' }] }) }) }) }),
    })
  })

  it('returns a fixed browser error and logs only safe identifiers when source configuration throws', async () => {
    mocks.getSourceAppPullConfig.mockImplementation(() => { throw new Error('provider token leaked') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await POST(new Request('https://tower.test/api/feedback/ticket-1/refresh', { method: 'POST' }), { params: Promise.resolve({ id: 'ticket-1' }) })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: refreshFailure })
    expect(warn).toHaveBeenCalledWith('Source refresh failed', { ticketId: 'ticket-1', appSlug: 'atlas', errorType: 'Error' })
    warn.mockRestore()
  })

  it('returns a factual no-change result for a duplicate source response', async () => {
    mocks.getSourceAppPullConfig.mockReturnValue({ url: 'https://atlas.test/export', token: 'secret' })
    mocks.fetchTicketsFromSource.mockResolvedValue([{ app: { slug: 'atlas' }, ticket: { externalId: 'ATLAS-42' } }])
    mocks.acceptLegacyPayload.mockResolvedValue({ appId: 'app-1', ticketId: 'ticket-1', result: 'duplicate' })
    mocks.legacyResult.mockReturnValue({ ticketId: 'ticket-1', created: false })

    const response = await POST(new Request('https://tower.test/api/feedback/ticket-1/refresh', { method: 'POST' }), { params: Promise.resolve({ id: 'ticket-1' }) })

    await expect(response.json()).resolves.toEqual({ ok: true, changed: false, ticketId: 'ticket-1' })
  })
})
