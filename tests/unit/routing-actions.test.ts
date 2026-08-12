import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  createGroup: vi.fn(),
  createChannel: vi.fn(),
  setAppPolicy: vi.fn(),
  retryFailedDelivery: vi.fn(),
  revalidatePath: vi.fn(),
  scheduleDeliveryWakeup: vi.fn(),
}))

vi.mock('@/lib/auth/guards', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/routing/groups', () => ({ createGroup: mocks.createGroup }))
vi.mock('@/lib/routing/channels', () => ({ createChannel: mocks.createChannel }))
vi.mock('@/lib/routing/policies', () => ({ setAppPolicy: mocks.setAppPolicy }))
vi.mock('@/lib/delivery/repository', () => ({ retryFailedDelivery: mocks.retryFailedDelivery }))
vi.mock('@/lib/delivery/worker', () => ({ scheduleDeliveryWakeup: mocks.scheduleDeliveryWakeup }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createAlertChannelAction, createTechnicalGroupAction } from '@/app/teams/actions'
import { updateAppPolicyAction } from '@/app/apps/actions'
import { retryDeliveryAction } from '@/app/deliveries/actions'

const admin = { id: 'admin-1', role: 'ADMIN' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminUser.mockResolvedValue(admin)
  mocks.createGroup.mockResolvedValue({ id: 'group-1' })
  mocks.createChannel.mockResolvedValue({ id: 'channel-1' })
  mocks.setAppPolicy.mockResolvedValue({ sourceAppId: 'app-1' })
  mocks.retryFailedDelivery.mockResolvedValue({ id: 'delivery-2', generation: 2 })
})

describe('routing administration actions', () => {
  it('rejects a support user before a technical-group mutation', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))

    await expect(createTechnicalGroupAction({ status: 'idle' }, form({ name: 'Platform' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.createGroup).not.toHaveBeenCalled()
  })

  it('rejects a support user before an alert-channel mutation', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))

    await expect(createAlertChannelAction({ status: 'idle' }, form({
      groupId: 'group-1', name: 'Ops', type: 'PUSHOVER', config: '{"appToken":"a","userKey":"u"}',
    }))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.createChannel).not.toHaveBeenCalled()
  })

  it('rejects a support user before an app-policy mutation', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))

    await expect(updateAppPolicyAction({ status: 'idle' }, form({
      sourceAppId: 'app-1', technicalGroupId: 'group-1', minimumPriority: 'HIGH', urgentCentralCopy: 'on', fallbackToCentral: 'on',
    }))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.setAppPolicy).not.toHaveBeenCalled()
  })

  it('creates a technical group as an admin and revalidates only teams', async () => {
    await expect(createTechnicalGroupAction({ status: 'idle' }, form({ name: ' Platform ', status: 'ACTIVE' }))).resolves.toEqual({
      status: 'success', message: 'Technical group created',
    })

    expect(mocks.createGroup).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Platform', status: 'ACTIVE', actorId: 'admin-1', reason: 'Created technical group',
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/teams')
  })

  it('returns visible Zod field errors without calling repositories', async () => {
    await expect(createTechnicalGroupAction({ status: 'idle' }, form({ name: '' }))).resolves.toEqual({
      status: 'error', message: 'Please correct the highlighted fields', fieldErrors: { name: expect.any(Array) },
    })

    expect(mocks.createGroup).not.toHaveBeenCalled()
  })

  it('updates an app policy as an admin and revalidates only apps', async () => {
    await expect(updateAppPolicyAction({ status: 'idle' }, form({
      sourceAppId: 'app-1', technicalGroupId: 'group-1', minimumPriority: 'HIGH', urgentCentralCopy: 'on', fallbackToCentral: 'on',
    }))).resolves.toEqual({ status: 'success', message: 'Alert policy updated' })

    expect(mocks.setAppPolicy).toHaveBeenCalledWith(expect.objectContaining({
      sourceAppId: 'app-1', technicalGroupId: 'group-1', minimumPriority: 'HIGH', actorId: 'admin-1',
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/apps')
  })

  it('queues a delivery retry as an admin and revalidates only deliveries', async () => {
    await expect(retryDeliveryAction({ status: 'idle' }, form({ deliveryId: 'delivery-1' }))).resolves.toEqual({
      status: 'success', message: 'Delivery queued',
    })

    expect(mocks.retryFailedDelivery).toHaveBeenCalledWith(expect.objectContaining({
      id: 'delivery-1', actorId: 'admin-1', reason: 'Retried failed delivery',
    }))
    expect(mocks.scheduleDeliveryWakeup).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/deliveries')
  })
})

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
