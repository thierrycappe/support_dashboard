import { describe, expect, it, vi } from 'vitest'
import { drainImmediateDeliveries, scheduleDeliveryWakeup } from '@/lib/delivery/worker'

describe('delivery wakeup drain', () => {
  it('drains batches until no eligible work remains', async () => {
    const sweep = vi.fn()
      .mockResolvedValueOnce({ started: 100 })
      .mockResolvedValueOnce({ started: 37 })
      .mockResolvedValueOnce({ started: 0 })
    await expect(drainImmediateDeliveries({ batchSize: 100, maxJobs: 500, maxDurationMs: 45_000, sweep })).resolves.toEqual({ started: 137, batches: 3 })
    expect(sweep).toHaveBeenCalledTimes(3)
  })

  it('begins no more than 500 eligible jobs across batches', async () => {
    const sweep = vi.fn(async ({ limit }: { limit: number }) => ({ started: limit }))
    await expect(drainImmediateDeliveries({ batchSize: 100, maxJobs: 500, maxDurationMs: 45_000, sweep })).resolves.toEqual({ started: 500, batches: 5 })
  })

  it('registers a post-response drain and absorbs scheduling failures', async () => {
    const drain = vi.fn(async () => undefined)
    let task: (() => Promise<void>) | undefined
    scheduleDeliveryWakeup({ afterImpl: (registered) => { task = registered }, drain })
    expect(drain).not.toHaveBeenCalled()
    await task!()
    expect(drain).toHaveBeenCalledOnce()
    expect(() => scheduleDeliveryWakeup({ afterImpl: () => { throw new Error('no request context') } })).not.toThrow()
  })
})
