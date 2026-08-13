import { describe, expect, it, vi } from 'vitest'
import { waitForApplicationDeliveriesToSettle } from '../../e2e/helpers/delivery-settlement'

describe('browser fixture delivery settlement', () => {
  it('waits until the exact application has no claimable or in-flight delivery', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ unsettled: 2 }] })
      .mockResolvedValueOnce({ rows: [{ unsettled: 0 }] })
    const wait = vi.fn(async () => undefined)

    await waitForApplicationDeliveriesToSettle({
      db: { query }, appId: 'fixture-app', timeoutMs: 1_000, pollMs: 10, wait,
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls.every(([, values]) => values[0] === 'fixture-app')).toBe(true)
    expect(query.mock.calls[0]![0]).toContain("outbox.status in ('PENDING', 'LEASED', 'RETRYING')")
    expect(wait).toHaveBeenCalledOnce()
  })

  it('fails through a bounded timeout instead of deleting active fixture rows', async () => {
    const query = vi.fn(async () => ({ rows: [{ unsettled: 1 }] }))
    let current = 0

    await expect(waitForApplicationDeliveriesToSettle({
      db: { query }, appId: 'fixture-app', timeoutMs: 20, pollMs: 10,
      now: () => current,
      wait: async (milliseconds) => { current += milliseconds },
    })).rejects.toThrow('Fixture deliveries did not settle')
    expect(query).toHaveBeenCalledTimes(3)
  })
})
