import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  drainImmediateDeliveries: vi.fn(async () => ({ started: 12, batches: 1 })),
  cleanupExpiredAssertionReplays: vi.fn(async (options?: { statementTimeoutMs?: number }) => Number(options?.statementTimeoutMs) * 0),
}))

vi.mock('@/lib/delivery/worker', () => ({ drainImmediateDeliveries: mocks.drainImmediateDeliveries }))
vi.mock('@/lib/service-auth/assertions', () => ({ cleanupExpiredAssertionReplays: mocks.cleanupExpiredAssertionReplays }))

import { GET } from '@/app/api/cron/deliver-alerts/route'
import { drainImmediateDeliveries } from '@/lib/delivery/worker'
import { cleanupExpiredAssertionReplays } from '@/lib/service-auth/assertions'

describe('deliver alerts cron', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.drainImmediateDeliveries.mockResolvedValue({ started: 12, batches: 1 })
    mocks.cleanupExpiredAssertionReplays.mockResolvedValue(0)
  })
  it('rejects unauthorized requests', async () => {
    expect((await GET(new Request('https://tower/api/cron/deliver-alerts'))).status).toBe(401)
    expect(drainImmediateDeliveries).not.toHaveBeenCalled()
    expect(cleanupExpiredAssertionReplays).not.toHaveBeenCalled()
  })
  it('fails closed when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(new Request('https://tower/api/cron/deliver-alerts'))).status).toBe(401)
    expect(drainImmediateDeliveries).not.toHaveBeenCalled()
    expect(cleanupExpiredAssertionReplays).not.toHaveBeenCalled()
  })
  it('runs the bounded recovery drain', async () => {
    const response = await GET(new Request('https://tower/api/cron/deliver-alerts', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      started: 12,
      batches: 1,
      assertionReplayCleanup: { status: 'completed', rowsDeleted: 0, batches: 1 },
    })
    expect(cleanupExpiredAssertionReplays).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }))
  })

  it('caps cleanup at five batches and 500 rows', async () => {
    mocks.cleanupExpiredAssertionReplays.mockResolvedValue(100)

    const response = await GET(authorizedRequest())

    expect(response.status).toBe(200)
    expect(cleanupExpiredAssertionReplays).toHaveBeenCalledTimes(5)
    await expect(response.json()).resolves.toMatchObject({
      started: 12,
      assertionReplayCleanup: { status: 'bounded', rowsDeleted: 500, batches: 5 },
    })
  })

  it('keeps delivery recovery successful and exposes only a sanitized cleanup failure', async () => {
    mocks.cleanupExpiredAssertionReplays.mockRejectedValue(new Error('database secret detail'))

    const response = await GET(authorizedRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(drainImmediateDeliveries).toHaveBeenCalledOnce()
    expect(body).toEqual({
      started: 12,
      batches: 1,
      assertionReplayCleanup: { status: 'failed', rowsDeleted: 0, batches: 0 },
    })
    expect(JSON.stringify(body)).not.toContain('database secret detail')
  })

  it('does not return while timed-out cleanup work is still running', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    mocks.cleanupExpiredAssertionReplays.mockImplementation((options?: { statementTimeoutMs?: number }) => new Promise<number>((_resolve, reject) => {
      inFlight += 1
      setTimeout(() => {
        inFlight -= 1
        reject(Object.assign(new Error('query cancelled'), { code: '57014' }))
      }, options?.statementTimeoutMs ?? 1_100)
    }))

    const responsePromise = GET(authorizedRequest())
    await vi.advanceTimersByTimeAsync(1_000)
    let returned = false
    void responsePromise.then(() => { returned = true })
    await Promise.resolve()

    expect({ returned, inFlight }).not.toEqual({ returned: true, inFlight: 1 })
    expect(inFlight).toBe(0)
    await vi.runAllTimersAsync()
    const response = await responsePromise

    expect(inFlight).toBe(0)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      started: 12,
      assertionReplayCleanup: { status: 'timed_out', rowsDeleted: 0, batches: 0 },
    })
  })
})

function authorizedRequest(): Request {
  return new Request('https://tower/api/cron/deliver-alerts', { headers: { authorization: 'Bearer cron-secret' } })
}
