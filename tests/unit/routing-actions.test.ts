import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  requireDeliveryRetryUser: vi.fn(),
  createGroup: vi.fn(),
  createChannel: vi.fn(),
  setAppPolicy: vi.fn(),
  retryFailedDelivery: vi.fn(),
  DeliveryRetryError: class DeliveryRetryError extends Error {
    constructor(readonly code: 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'STALE') { super(code) }
  },
  revalidatePath: vi.fn(),
  scheduleDeliveryWakeup: vi.fn(),
}))

vi.mock('@/lib/auth/guards', () => ({
  requireAdminUser: mocks.requireAdminUser,
  requireDeliveryRetryUser: mocks.requireDeliveryRetryUser,
}))
vi.mock('@/lib/routing/groups', () => ({ createGroup: mocks.createGroup }))
vi.mock('@/lib/routing/channels', () => ({ createChannel: mocks.createChannel }))
vi.mock('@/lib/routing/policies', () => ({ setAppPolicy: mocks.setAppPolicy }))
vi.mock('@/lib/delivery/repository', () => ({
  retryFailedDelivery: mocks.retryFailedDelivery,
  DeliveryRetryError: mocks.DeliveryRetryError,
}))
vi.mock('@/lib/delivery/worker', () => ({ scheduleDeliveryWakeup: mocks.scheduleDeliveryWakeup }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createAlertChannelAction, createTechnicalGroupAction } from '@/app/teams/actions'
import { updateAppPolicyAction } from '@/app/apps/actions'
import { retryDeliveryAction } from '@/app/deliveries/actions'

const admin = { id: 'admin-1', role: 'ADMIN' }
const support = { id: 'support-1', role: 'SUPPORT' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminUser.mockResolvedValue(admin)
  mocks.requireDeliveryRetryUser.mockResolvedValue(admin)
  mocks.createGroup.mockResolvedValue({ id: 'group-1' })
  mocks.createChannel.mockResolvedValue({ id: 'channel-1' })
  mocks.setAppPolicy.mockResolvedValue({ sourceAppId: 'app-1' })
  mocks.retryFailedDelivery.mockResolvedValue({ outcome: 'created', delivery: { id: 'delivery-2', generation: 2, status: 'PENDING' } })
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

  it('allows a support user to queue an eligible failed delivery retry', async () => {
    mocks.requireDeliveryRetryUser.mockResolvedValue(support)

    await expect(retryDeliveryAction({ status: 'idle' }, form({ deliveryId: 'delivery-1' }))).resolves.toEqual({
      status: 'success', message: 'Delivery queued',
    })

    expect(mocks.retryFailedDelivery).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'support-1' }))
    expect(mocks.requireAdminUser).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated user before retrying a delivery', async () => {
    mocks.requireDeliveryRetryUser.mockRejectedValue(new Error('NEXT_REDIRECT'))

    await expect(retryDeliveryAction({ status: 'idle' }, form({ deliveryId: 'delivery-1' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.retryFailedDelivery).not.toHaveBeenCalled()
  })

  it('does not expose an arbitrary retry infrastructure error', async () => {
    mocks.retryFailedDelivery.mockRejectedValue(new Error('postgresql://secret-host/internal failure'))

    await expect(retryDeliveryAction({ status: 'idle' }, form({ deliveryId: 'delivery-1' }))).resolves.toEqual({
      status: 'error', message: 'Delivery could not be queued',
    })
    expect(mocks.scheduleDeliveryWakeup).not.toHaveBeenCalled()
  })

  it('maps a known retry lifecycle error to a factual public message', async () => {
    mocks.retryFailedDelivery.mockRejectedValue(new mocks.DeliveryRetryError('NOT_ELIGIBLE'))

    await expect(retryDeliveryAction({ status: 'idle' }, form({ deliveryId: 'delivery-1' }))).resolves.toEqual({
      status: 'error', message: 'Only failed deliveries can be retried',
    })
    expect(mocks.scheduleDeliveryWakeup).not.toHaveBeenCalled()
  })

  it('reports an already pending duplicate retry truthfully', async () => {
    mocks.retryFailedDelivery.mockResolvedValue({ outcome: 'duplicate', delivery: { id: 'delivery-2', generation: 2, status: 'PENDING' } })

    await expect(retryDeliveryAction({ status: 'idle' }, form({ deliveryId: 'delivery-1' }))).resolves.toEqual({
      status: 'success', message: 'Delivery already queued',
    })
  })

  it('maps rejected channel validation to the configuration field', async () => {
    mocks.createChannel.mockRejectedValue(new Error('Invalid channel configuration'))

    await expect(createAlertChannelAction({ status: 'idle' }, form({
      groupId: 'group-1', name: 'Ops', type: 'WEBHOOK', config: '{"url":"https://example.test","signingSecret":"secret"}',
    }))).resolves.toEqual({
      status: 'error', message: 'Please correct the highlighted fields', fieldErrors: { config: ['Channel configuration is invalid'] },
    })
  })

  it('keeps alert-channel infrastructure failures generic', async () => {
    mocks.createChannel.mockRejectedValue(new Error('Channel encryption keyring is not configured'))

    await expect(createAlertChannelAction({ status: 'idle' }, form({
      groupId: 'group-1', name: 'Ops', type: 'PUSHOVER', config: '{"appToken":"a","userKey":"u"}',
    }))).resolves.toEqual({ status: 'error', message: 'Alert channel was not created' })
  })
})

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
