import { beforeEach, describe, expect, it, vi } from 'vitest'

type CleanupOutcome = { status: 'completed' | 'bounded' | 'failed' | 'timed_out'; rowsDeleted: number; batches: number }

const mocks = vi.hoisted(() => ({
  drainImmediateDeliveries: vi.fn(async () => ({ started: 12, batches: 1 })),
  drainExpiredAssertionReplays: vi.fn<() => Promise<CleanupOutcome>>(async () => ({ status: 'completed', rowsDeleted: 0, batches: 1 })),
  drainExpiredRateLimitBuckets: vi.fn<() => Promise<CleanupOutcome>>(async () => ({ status: 'completed', rowsDeleted: 0, batches: 1 })),
}))

vi.mock('@/lib/delivery/worker', () => ({ drainImmediateDeliveries: mocks.drainImmediateDeliveries }))
vi.mock('@/lib/service-auth/maintenance', () => ({
  drainExpiredAssertionReplays: mocks.drainExpiredAssertionReplays,
  drainExpiredRateLimitBuckets: mocks.drainExpiredRateLimitBuckets,
}))

import { GET } from '@/app/api/cron/deliver-alerts/route'
import { drainImmediateDeliveries } from '@/lib/delivery/worker'
import { drainExpiredAssertionReplays, drainExpiredRateLimitBuckets } from '@/lib/service-auth/maintenance'

describe('deliver alerts cron', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.drainImmediateDeliveries.mockResolvedValue({ started: 12, batches: 1 })
    mocks.drainExpiredAssertionReplays.mockResolvedValue({ status: 'completed', rowsDeleted: 0, batches: 1 })
    mocks.drainExpiredRateLimitBuckets.mockResolvedValue({ status: 'completed', rowsDeleted: 0, batches: 1 })
  })
  it('rejects unauthorized requests', async () => {
    expect((await GET(new Request('https://tower/api/cron/deliver-alerts'))).status).toBe(401)
    expect(drainImmediateDeliveries).not.toHaveBeenCalled()
    expect(drainExpiredAssertionReplays).not.toHaveBeenCalled()
    expect(drainExpiredRateLimitBuckets).not.toHaveBeenCalled()
  })
  it('fails closed when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(new Request('https://tower/api/cron/deliver-alerts'))).status).toBe(401)
    expect(drainImmediateDeliveries).not.toHaveBeenCalled()
    expect(drainExpiredAssertionReplays).not.toHaveBeenCalled()
    expect(drainExpiredRateLimitBuckets).not.toHaveBeenCalled()
  })
  it('runs the bounded recovery drain', async () => {
    const response = await GET(new Request('https://tower/api/cron/deliver-alerts', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      started: 12,
      batches: 1,
      assertionReplayCleanup: { status: 'completed', rowsDeleted: 0, batches: 1 },
      rateLimitBucketCleanup: { status: 'completed', rowsDeleted: 0, batches: 1 },
    })
    expect(drainExpiredAssertionReplays).toHaveBeenCalledOnce()
    expect(drainExpiredRateLimitBuckets).toHaveBeenCalledOnce()
  })

  it('exposes bounded rate-limit cleanup without affecting delivery recovery', async () => {
    mocks.drainExpiredRateLimitBuckets.mockResolvedValue({ status: 'bounded', rowsDeleted: 500, batches: 5 })

    const response = await GET(authorizedRequest())

    expect(response.status).toBe(200)
    expect(drainImmediateDeliveries).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({
      started: 12,
      rateLimitBucketCleanup: { status: 'bounded', rowsDeleted: 500, batches: 5 },
    })
  })

  it('keeps delivery recovery successful and exposes only a sanitized cleanup failure', async () => {
    mocks.drainExpiredAssertionReplays.mockResolvedValue({ status: 'failed', rowsDeleted: 0, batches: 0 })
    mocks.drainExpiredRateLimitBuckets.mockResolvedValue({ status: 'failed', rowsDeleted: 0, batches: 0 })

    const response = await GET(authorizedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(drainImmediateDeliveries).toHaveBeenCalledOnce()
    expect(body).toEqual({
      started: 12,
      batches: 1,
      assertionReplayCleanup: { status: 'failed', rowsDeleted: 0, batches: 0 },
      rateLimitBucketCleanup: { status: 'failed', rowsDeleted: 0, batches: 0 },
    })
  })

  it('waits for the bounded cleanup outcome before responding', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    mocks.drainExpiredRateLimitBuckets.mockImplementation(() => new Promise<CleanupOutcome>((resolve) => {
      inFlight += 1
      setTimeout(() => {
        inFlight -= 1
        resolve({ status: 'timed_out', rowsDeleted: 0, batches: 0 })
      }, 1_000)
    }))

    const responsePromise = GET(authorizedRequest())
    await vi.advanceTimersByTimeAsync(999)
    let returned = false
    void responsePromise.then(() => { returned = true })
    await Promise.resolve()

    expect({ returned, inFlight }).toEqual({ returned: false, inFlight: 1 })
    await vi.advanceTimersByTimeAsync(1)
    const response = await responsePromise

    expect(inFlight).toBe(0)
    await expect(response.json()).resolves.toMatchObject({
      rateLimitBucketCleanup: { status: 'timed_out', rowsDeleted: 0, batches: 0 },
    })
  })
})

function authorizedRequest(): Request {
  return new Request('https://tower/api/cron/deliver-alerts', { headers: { authorization: 'Bearer cron-secret' } })
}
