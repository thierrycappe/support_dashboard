import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), change: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/auth/guards', () => ({ requireAdminUser: mocks.admin }))
vi.mock('@/lib/apps/lifecycle', async (original) => ({ ...await original<typeof import('@/lib/apps/lifecycle')>(), changeApplicationLifecycle: mocks.change }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
import { applicationLifecycleAction } from '@/app/apps/actions'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT') })
  mocks.admin.mockResolvedValue({ id: 'admin-1' })
  mocks.change.mockResolvedValue({ invitation: null })
})
function form(operation = 'suspend') {
  const data = new FormData()
  data.set('appId', 'app-1'); data.set('operation', operation)
  return data
}
it.each(['resubmit', 'suspend', 'resume', 'delete'])('requires administrator access for %s', async (operation) => {
  mocks.admin.mockRejectedValue(new Error('Unauthorized'))
  await expect(applicationLifecycleAction({ status: 'idle' }, form(operation))).rejects.toThrow('Unauthorized')
  expect(mocks.change).not.toHaveBeenCalled()
})
it('rejects an unknown operation and unconfirmed deletion', async () => {
  for (const operation of ['unknown', 'delete']) {
    expect(await applicationLifecycleAction({ status: 'idle' }, form(operation))).toMatchObject({ status: 'error' })
  }
  expect(mocks.change).not.toHaveBeenCalled()
})
it('passes the authenticated actor and only deletes after confirmation', async () => {
  const data = form('delete'); data.set('confirmed', 'on')
  await expect(applicationLifecycleAction({ status: 'idle' }, data)).rejects.toThrow('NEXT_REDIRECT')
  expect(mocks.redirect).toHaveBeenCalledWith('/apps')
  expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1', operation: 'delete', actorId: 'admin-1' }))
  expect(mocks.revalidate).toHaveBeenCalledWith('/apps')
  expect(mocks.revalidate).toHaveBeenCalledWith('/apps/app-1')
})
it('returns the replacement invitation even when cache invalidation fails', async () => {
  mocks.change.mockResolvedValue({ invitation: { id: 'grant', secret: 'one-time-secret', expiresAt: new Date('2026-09-11T12:00:00Z') } })
  mocks.revalidate.mockImplementation(() => { throw new Error('Cache failure') })
  expect(await applicationLifecycleAction({ status: 'idle' }, form('resubmit'))).toEqual({ status: 'created', appId: 'app-1', invitationId: 'grant', invitationSecret: 'one-time-secret', expiresAt: '2026-09-11T12:00:00.000Z' })
})
it('does not expose unexpected database errors', async () => {
  mocks.change.mockRejectedValue(new Error('private database details'))
  const result = await applicationLifecycleAction({ status: 'idle' }, form())
  expect(result.status).toBe('error')
  expect(JSON.stringify(result)).not.toContain('private database details')
})
