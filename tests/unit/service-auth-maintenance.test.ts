import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupExpiredAssertionReplays: vi.fn(async () => 0),
  cleanupExpiredServiceRateLimitBuckets: vi.fn(async () => 0),
}))

vi.mock('@/lib/service-auth/assertions', () => ({ cleanupExpiredAssertionReplays: mocks.cleanupExpiredAssertionReplays }))
vi.mock('@/lib/service-auth/rate-limit', () => ({ cleanupExpiredServiceRateLimitBuckets: mocks.cleanupExpiredServiceRateLimitBuckets }))

import { drainExpiredRateLimitBuckets } from '@/lib/service-auth/maintenance'

describe('service authentication maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cleanupExpiredServiceRateLimitBuckets.mockResolvedValue(0)
  })

  it('caps rate-limit cleanup at five batches and 500 rows', async () => {
    mocks.cleanupExpiredServiceRateLimitBuckets.mockResolvedValue(100)

    await expect(drainExpiredRateLimitBuckets()).resolves.toEqual({ status: 'bounded', rowsDeleted: 500, batches: 5 })
    expect(mocks.cleanupExpiredServiceRateLimitBuckets).toHaveBeenCalledTimes(5)
    expect(mocks.cleanupExpiredServiceRateLimitBuckets).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100 }))
  })

  it('returns a sanitized failed outcome when rate-limit cleanup fails', async () => {
    mocks.cleanupExpiredServiceRateLimitBuckets.mockRejectedValue(new Error('database secret detail'))

    await expect(drainExpiredRateLimitBuckets()).resolves.toEqual({ status: 'failed', rowsDeleted: 0, batches: 0 })
  })
})
