// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from 'jose'
import type { ServicePrincipal } from '@/lib/service-auth/assertions'

const mocks = vi.hoisted(() => ({ getActiveCredential: vi.fn() }))
vi.mock('@/lib/service-auth/credentials', () => ({ getActiveCredential: mocks.getActiveCredential }))

import {
  AccessTokenVerificationError,
  SERVICE_ACCESS_TOKEN_AUDIENCE,
  SERVICE_ACCESS_TOKEN_ISSUER,
  issueServiceAccessToken,
  verifyServiceAccessToken,
} from '@/lib/service-auth/access-tokens'

const now = new Date('2026-08-12T12:00:00.000Z')
const principal: ServicePrincipal = { appId: 'app-1', credentialId: 'credential-1', scopes: ['escalations:write'] }

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  process.env.SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK = JSON.stringify(await exportJWK(pair.privateKey))
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActiveCredential.mockResolvedValue({ id: 'credential-1', sourceAppId: 'app-1' })
})

describe('portal access tokens', () => {
  it('issues and verifies an EdDSA token with exact issuer, audience, identity, scopes, and five-minute lifetime', async () => {
    const token = await issueServiceAccessToken({ principal, now })

    await expect(verifyServiceAccessToken({ token, now })).resolves.toEqual(principal)
    const privateJwk = JSON.parse(process.env.SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK!) as Record<string, unknown>
    delete privateJwk.d
    const decoded = await jwtVerify(token, await importJWK(privateJwk, 'EdDSA'), { algorithms: ['EdDSA'], currentDate: now })
    expect(decoded.payload).toMatchObject({
      iss: SERVICE_ACCESS_TOKEN_ISSUER,
      aud: SERVICE_ACCESS_TOKEN_AUDIENCE,
      sub: 'app-1',
      appId: 'app-1',
      credentialId: 'credential-1',
      scope: ['escalations:write'],
    })
    expect((decoded.payload.exp ?? 0) - (decoded.payload.iat ?? 0)).toBe(300)
    expect(token.split('.')).toHaveLength(3)
    expect(SERVICE_ACCESS_TOKEN_ISSUER).toBe('support-tower')
    expect(SERVICE_ACCESS_TOKEN_AUDIENCE).toBe('support-tower-service')
  })

  it('rejects a token immediately when its credential is no longer active', async () => {
    const token = await issueServiceAccessToken({ principal, now })
    mocks.getActiveCredential.mockResolvedValue(null)

    await expect(verifyServiceAccessToken({ token, now })).rejects.toThrow('Invalid service access token')
  })

  it('preserves an active-credential database failure as typed unavailability', async () => {
    const token = await issueServiceAccessToken({ principal, now })
    mocks.getActiveCredential.mockRejectedValue(Object.assign(new Error('database unavailable'), { code: '08006' }))

    await expect(verifyServiceAccessToken({ token, now })).rejects.toEqual(new AccessTokenVerificationError('unavailable'))
  })

  it('preserves signing-key configuration failure as typed unavailability', async () => {
    const token = await issueServiceAccessToken({ principal, now })

    await expect(verifyServiceAccessToken({ token, now, privateJwk: {} })).rejects.toEqual(new AccessTokenVerificationError('unavailable'))
  })

  it('rejects expiry beyond the five-minute maximum', async () => {
    await expect(issueServiceAccessToken({ principal, now, expiresInSeconds: 301 })).rejects.toThrow('Invalid service access token lifetime')
  })

  it('allows the required five-second clock tolerance at expiry', async () => {
    const token = await issueServiceAccessToken({ principal, now, expiresInSeconds: 1 })

    await expect(verifyServiceAccessToken({ token, now: new Date(now.getTime() + 5_000) })).resolves.toEqual(principal)
  })
})
