import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/feedback/source-pull', () => ({
  listConfiguredPullSlugs: vi.fn(() => ['casal-track']),
  pullSourceApp: vi.fn(async () => ({
    appSlug: 'casal-track',
    pulled: 0,
    created: 0,
    updated: 0,
    errors: [],
  })),
}))

vi.mock('@/lib/db', () => ({ hasDatabaseUrl: () => true }))

import { GET } from '@/app/api/cron/sync-source-apps/route'
import { pullSourceApp } from '@/lib/feedback/source-pull'

describe('sync-source-apps cron', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.clearAllMocks()
  })

  it('rejects unauthorized requests', async () => {
    const req = new Request('https://tower/api/cron/sync-source-apps')
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(pullSourceApp).not.toHaveBeenCalled()
  })

  it('pulls every configured app without a cursor', async () => {
    const req = new Request('https://tower/api/cron/sync-source-apps', {
      headers: { authorization: 'Bearer cron-secret' },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(pullSourceApp).toHaveBeenCalledTimes(1)

    const arg = vi.mocked(pullSourceApp).mock.calls[0][0]
    expect(arg.appSlug).toBe('casal-track')
    expect(arg).not.toHaveProperty('resolveSince')
  })
})
