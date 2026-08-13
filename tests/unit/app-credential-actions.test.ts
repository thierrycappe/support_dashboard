import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  beginAdminCredentialRotation: vi.fn(),
  revokeCredential: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/auth/guards', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/service-auth/credentials', () => ({
  beginAdminCredentialRotation: mocks.beginAdminCredentialRotation,
  revokeCredential: mocks.revokeCredential,
  RotationError: class RotationError extends Error { constructor(readonly code: string) { super(code) } },
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { beginAdminRotationAction, revokeAppCredentialAction } from '@/app/apps/actions'

const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: '11qYAYdk9JmseBDYzK6h4Zl8-QAjhqffIv2fjd3puEk' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' })
  mocks.beginAdminCredentialRotation.mockResolvedValue({
    credentialId: 'credential-next', challenge: 'one-time-challenge', expiresAt: new Date('2026-08-13T10:05:00.000Z'),
  })
  mocks.revokeCredential.mockResolvedValue(true)
})

describe('admin credential actions', () => {
  it('authenticates before parsing or mutating rotation input', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(beginAdminRotationAction({ status: 'idle' }, new FormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.beginAdminCredentialRotation).not.toHaveBeenCalled()
  })

  it('returns field recovery for malformed JSON without echoing submitted key material', async () => {
    const form = rotationForm('{"d":"private-key-material"')
    const state = await beginAdminRotationAction({ status: 'idle' }, form)
    expect(state).toEqual({
      status: 'error', message: 'Review the rotation details and try again.',
      fieldErrors: { publicJwk: ['Enter a valid Ed25519 public JWK.'] },
    })
    expect(JSON.stringify(state)).not.toContain('private-key-material')
    expect(mocks.beginAdminCredentialRotation).not.toHaveBeenCalled()
  })

  it('returns a one-time challenge only after the durable admin-assisted rotation begins', async () => {
    await expect(beginAdminRotationAction({ status: 'idle' }, rotationForm(JSON.stringify(publicJwk)))).resolves.toEqual({
      status: 'created', credentialId: 'credential-next', challenge: 'one-time-challenge',
      expiresAt: '2026-08-13T10:05:00.000Z',
    })
    expect(mocks.beginAdminCredentialRotation).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1', parentCredentialId: 'credential-current', nextPublicJwk: publicJwk, actorId: 'admin-1',
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/apps/app-1')
  })

  it('sanitizes a rotation service failure without returning submitted keys or raw errors', async () => {
    mocks.beginAdminCredentialRotation.mockRejectedValue(new Error('database private-key-material'))
    const state = await beginAdminRotationAction({ status: 'idle' }, rotationForm(JSON.stringify(publicJwk)))
    expect(state).toEqual({ status: 'error', message: 'Key rotation was not started. Check credential health and try again.', fieldErrors: {} })
    expect(JSON.stringify(state)).not.toContain('private-key-material')
  })

  it('revokes as the authenticated user and reports last-active safety factually', async () => {
    const form = new FormData(); form.set('appId', 'app-1'); form.set('credentialId', 'credential-current')
    await expect(revokeAppCredentialAction({ status: 'idle' }, form)).resolves.toEqual({ status: 'success', message: 'Credential revoked' })
    expect(mocks.revokeCredential).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-1', credentialId: 'credential-current', actorId: 'admin-1', actorType: 'USER',
    }))

    mocks.revokeCredential.mockRejectedValue(Object.assign(new Error('LAST_ACTIVE_CREDENTIAL'), { code: 'LAST_ACTIVE_CREDENTIAL' }))
    await expect(revokeAppCredentialAction({ status: 'idle' }, form)).resolves.toEqual({
      status: 'error', message: 'This is the last active credential. Activate another credential before revoking it.',
    })
  })

  it('authenticates before revocation and never exposes an unexpected service error', async () => {
    const form = new FormData(); form.set('appId', 'app-1'); form.set('credentialId', 'credential-current')
    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(revokeAppCredentialAction({ status: 'idle' }, form)).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.revokeCredential).not.toHaveBeenCalled()

    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' })
    mocks.revokeCredential.mockRejectedValue(new Error('provider token should stay private'))
    const state = await revokeAppCredentialAction({ status: 'idle' }, form)
    expect(state).toEqual({ status: 'error', message: 'Credential was not revoked. Refresh the page and try again.' })
    expect(JSON.stringify(state)).not.toContain('provider token')
  })
})

function rotationForm(jwk: string): FormData {
  const form = new FormData()
  form.set('appId', 'app-1')
  form.set('parentCredentialId', 'credential-current')
  form.set('publicJwk', jwk)
  return form
}
