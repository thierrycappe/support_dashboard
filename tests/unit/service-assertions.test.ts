// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, generateSecret } from 'jose'

const mocks = vi.hoisted(() => ({
  getActiveCredential: vi.fn(),
  recordAssertionReplay: vi.fn(),
}))

vi.mock('@/lib/service-auth/credentials', () => ({ getActiveCredential: mocks.getActiveCredential }))

import { verifyClientAssertion } from '@/lib/service-auth/assertions'

const now = new Date('2026-08-12T12:00:00.000Z')
const audience = 'support-tower-service'
const keys = await generateKeyPair('EdDSA', { extractable: true })
const publicJwk = await exportJWK(keys.publicKey)
const wrongKeys = await generateKeyPair('EdDSA', { extractable: true })
const hmacKey = await generateSecret('HS256')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActiveCredential.mockResolvedValue({ id: 'credential-1', sourceAppId: 'app-1', publicJwk })
  mocks.recordAssertionReplay.mockResolvedValue(undefined)
})

describe('client assertions', () => {
  it('accepts an EdDSA assertion bound to its app and active kid', async () => {
    const assertion = await signedAssertion()

    await expect(verifyClientAssertion({ db: {} as never, assertion, audience, now, recordReplay: mocks.recordAssertionReplay })).resolves.toEqual({
      appId: 'app-1', credentialId: 'credential-1', scopes: ['escalations:write'],
    })
    expect(mocks.recordAssertionReplay).toHaveBeenCalledWith(expect.objectContaining({ credentialId: 'credential-1', jti: 'assertion-1' }))
  })

  it.each([
    ['wrong signing key', () => signedAssertion({ key: wrongKeys.privateKey })],
    ['wrong algorithm', () => signedAssertion({ alg: 'HS256' })],
    ['issuer different from subject', () => signedAssertion({ issuer: 'other-app' })],
    ['wrong audience', () => signedAssertion({ audience: 'other-audience' })],
    ['expiration more than sixty seconds after issuance', () => signedAssertion({ expOffset: 61 })],
    ['future issued-at beyond tolerance', () => signedAssertion({ iatOffset: 6, expOffset: 30 })],
    ['missing jti', () => signedAssertion({ jti: undefined })],
  ])('rejects %s', async (_name, build) => {
    await expect(verifyClientAssertion({ db: {} as never, assertion: await build(), audience, now, recordReplay: mocks.recordAssertionReplay })).rejects.toThrow('Invalid client assertion')
    expect(mocks.recordAssertionReplay).not.toHaveBeenCalled()
  })

  it('rejects an unknown or revoked kid before consuming replay state', async () => {
    mocks.getActiveCredential.mockResolvedValue(null)
    await expect(verifyClientAssertion({ db: {} as never, assertion: await signedAssertion(), audience, now, recordReplay: mocks.recordAssertionReplay })).rejects.toThrow('Invalid client assertion')
    expect(mocks.recordAssertionReplay).not.toHaveBeenCalled()
  })
})

async function signedAssertion(options: {
  key?: CryptoKey
  alg?: 'EdDSA' | 'HS256'
  issuer?: string
  audience?: string
  iatOffset?: number
  expOffset?: number
  jti?: string | undefined
} = {}): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000) + (options.iatOffset ?? 0)
  const jwt = new SignJWT({ scope: ['escalations:write'] })
    .setProtectedHeader({ alg: options.alg ?? 'EdDSA', kid: 'credential-1' })
    .setIssuer(options.issuer ?? 'app-1')
    .setSubject('app-1')
    .setAudience(options.audience ?? audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (options.expOffset ?? 30))
  if (options.jti !== undefined || !('jti' in options)) jwt.setJti(options.jti ?? 'assertion-1')
  return jwt.sign(options.key ?? (options.alg === 'HS256' ? hmacKey : keys.privateKey))
}
