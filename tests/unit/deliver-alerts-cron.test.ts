import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/delivery/worker', () => ({ drainImmediateDeliveries: vi.fn(async () => ({ started: 12, batches: 1 })) }))

import { GET } from '@/app/api/cron/deliver-alerts/route'
import { drainImmediateDeliveries } from '@/lib/delivery/worker'

describe('deliver alerts cron', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'cron-secret'; vi.clearAllMocks() })
  it('rejects unauthorized requests', async () => {
    expect((await GET(new Request('https://tower/api/cron/deliver-alerts'))).status).toBe(401)
    expect(drainImmediateDeliveries).not.toHaveBeenCalled()
  })
  it('fails closed when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(new Request('https://tower/api/cron/deliver-alerts'))).status).toBe(401)
    expect(drainImmediateDeliveries).not.toHaveBeenCalled()
  })
  it('runs the bounded recovery drain', async () => {
    const response = await GET(new Request('https://tower/api/cron/deliver-alerts', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ started: 12, batches: 1 })
  })
})
