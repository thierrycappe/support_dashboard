import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdminUser: vi.fn(), createApplicationEnrollment: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/guards', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/apps/queries', () => ({ createApplicationEnrollment: mocks.createApplicationEnrollment }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createEnrollmentAction } from '@/app/apps/actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' })
  mocks.createApplicationEnrollment.mockResolvedValue({ appId: 'app-1', invitation: { id: 'grant-1', secret: 'secret', expiresAt: new Date('2026-08-12T15:30:00.000Z') } })
})

describe('create enrollment action', () => {
  it.each(['support', 'unauthenticated'])('denies a forged valid form for a %s caller before parsing or mutation', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(createEnrollmentAction({ status: 'idle' }, validForm())).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.createApplicationEnrollment).not.toHaveBeenCalled()
  })

  it('returns field-specific recovery without entering the transaction', async () => {
    const form = validForm(); form.set('slug', 'Not a slug')
    await expect(createEnrollmentAction({ status: 'idle' }, form)).resolves.toMatchObject({
      status: 'error', message: 'Please correct the highlighted fields', fieldErrors: { slug: expect.any(Array) },
    })
    expect(mocks.createApplicationEnrollment).not.toHaveBeenCalled()
  })

  it('returns the invitation exactly once from an admin-created transaction', async () => {
    await expect(createEnrollmentAction({ status: 'idle' }, validForm())).resolves.toEqual({
      status: 'created', appId: 'app-1', invitationId: 'grant-1', invitationSecret: 'secret', expiresAt: '2026-08-12T15:30:00.000Z',
    })
    expect(mocks.createApplicationEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-1', name: 'Atlas Checkout', slug: 'atlas-checkout', ownerIds: ['user-1'], minimumPriority: 'HIGH',
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/apps')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/apps/app-1')
  })
})

function validForm(): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries({ name: 'Atlas Checkout', slug: 'atlas-checkout', baseUrl: 'https://atlas.example.test', environment: 'production', minimumPriority: 'HIGH', urgentCentralCopy: 'on', fallbackToCentral: 'on' })) form.set(key, value)
  form.append('ownerIds', 'user-1')
  return form
}
