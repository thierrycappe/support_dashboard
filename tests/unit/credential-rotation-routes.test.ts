// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleCredentialRotation } from '@/app/api/v1/credentials/rotate/route'
import { handleCredentialRotationConfirmation } from '@/app/api/v1/credentials/rotate/confirm/route'
import { RotationError } from '@/lib/service-auth/credentials'

const correlationId = 'rotation-correlation'
const principal = { appId: 'app-1', credentialId: 'credential-current', scopes: ['credentials:rotate' as const] }

describe('credential rotation route contracts', () => {
  it('returns exact no-store begin and confirm envelopes', async () => {
    const begin = await handleCredentialRotation(request('/api/v1/credentials/rotate', {
      nextPublicKey: jwk(), proof: 'current-key-proof',
    }), {
      principal: vi.fn(async () => principal),
      begin: vi.fn(async () => ({ credentialId: 'credential-next', challenge: 'challenge-secret', expiresAt: new Date('2026-08-12T12:05:00.000Z') })),
    })
    expect(begin.status).toBe(201)
    await expect(begin.json()).resolves.toEqual({ credentialId: 'credential-next', challenge: 'challenge-secret', expiresAt: '2026-08-12T12:05:00.000Z' })
    expect(begin.headers.get('cache-control')).toBe('no-store')

    const confirm = await handleCredentialRotationConfirmation(request('/api/v1/credentials/rotate/confirm', {
      credentialId: 'credential-next', challenge: 'challenge-secret', signature: 'signature', overlapSeconds: 3_600,
    }), {
      principal: vi.fn(async () => principal),
      confirm: vi.fn(async () => ({ credentialId: 'credential-next', oldCredentialValidUntil: new Date('2026-08-12T13:00:00.000Z') })),
    })
    expect(confirm.status).toBe(200)
    await expect(confirm.json()).resolves.toEqual({ credentialId: 'credential-next', status: 'ACTIVE', oldCredentialValidUntil: '2026-08-12T13:00:00.000Z' })
    expect(confirm.headers.get('cache-control')).toBe('no-store')
  })

  it('requires bearer scope plus current-key proof and sanitizes proof failures', async () => {
    const missingBearer = await handleCredentialRotation(request('/api/v1/credentials/rotate', { nextPublicKey: jwk(), proof: 'proof' }), {
      principal: vi.fn(async () => { throw new Error('missing') }), begin: vi.fn(),
    })
    expect(await error(missingBearer)).toEqual([401, 'INVALID_ACCESS_TOKEN'])

    const proof = 'private-proof-material'
    const invalidProof = await handleCredentialRotation(request('/api/v1/credentials/rotate', { nextPublicKey: jwk(), proof }), {
      principal: vi.fn(async () => principal), begin: vi.fn(async () => { throw new RotationError('INVALID_PROOF') }),
    })
    expect(await error(invalidProof)).toEqual([401, 'INVALID_ROTATION_PROOF'])
    expect(await invalidProof.clone().text()).not.toContain(proof)
  })

  it('maps conflicts, invalid challenge, persistence, media type, and size safely', async () => {
    const conflict = await handleCredentialRotation(request('/api/v1/credentials/rotate', { nextPublicKey: jwk(), proof: 'proof' }), {
      principal: vi.fn(async () => principal), begin: vi.fn(async () => { throw new RotationError('ROTATION_IN_PROGRESS') }),
    })
    expect(await error(conflict)).toEqual([409, 'ROTATION_IN_PROGRESS'])

    const invalid = await handleCredentialRotationConfirmation(request('/api/v1/credentials/rotate/confirm', {
      credentialId: 'next', challenge: 'secret', signature: 'wrong', overlapSeconds: 1,
    }), { principal: vi.fn(async () => principal), confirm: vi.fn(async () => { throw new RotationError('INVALID_CHALLENGE') }) })
    expect(await error(invalid)).toEqual([401, 'INVALID_ROTATION_CHALLENGE'])

    const failed = await handleCredentialRotation(request('/api/v1/credentials/rotate', { nextPublicKey: jwk(), proof: 'proof' }), {
      principal: vi.fn(async () => principal), begin: vi.fn(async () => { throw Object.assign(new Error('database password'), { code: '08006' }) }),
    })
    expect(await error(failed)).toEqual([503, 'SERVICE_UNAVAILABLE'])
    expect(await failed.clone().text()).not.toContain('database password')

    const media = await handleCredentialRotation(request('/api/v1/credentials/rotate', { nextPublicKey: jwk(), proof: 'proof' }, 'text/plain'), {
      principal: vi.fn(async () => principal), begin: vi.fn(),
    })
    expect(await error(media)).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE'])

    const large = await handleCredentialRotation(new Request('https://support.example/api/v1/credentials/rotate', {
      method: 'POST', headers: headers('application/json'), body: JSON.stringify({ nextPublicKey: jwk(), proof: 'x'.repeat(40_000) }),
    }), { principal: vi.fn(async () => principal), begin: vi.fn(), maxBodyBytes: 1_024 })
    expect(await error(large)).toEqual([413, 'PAYLOAD_TOO_LARGE'])
  })
})

function request(path: string, body: unknown, contentType = 'application/json; charset=utf-8'): Request {
  return new Request(`https://support.example${path}`, { method: 'POST', headers: headers(contentType), body: JSON.stringify(body) })
}

function headers(contentType: string): Record<string, string> {
  return { authorization: 'Bearer access-token', 'content-type': contentType, 'x-correlation-id': correlationId }
}

async function error(response: Response): Promise<[number, string]> {
  const body = await response.clone().json() as { error: { code: string; correlationId: string } }
  expect(body.error.correlationId).toBe(correlationId)
  expect(response.headers.get('cache-control')).toBe('no-store')
  return [response.status, body.error.code]
}

function jwk() { return { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) } }
