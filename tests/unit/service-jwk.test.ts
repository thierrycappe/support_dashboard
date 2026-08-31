import { describe, expect, it } from 'vitest'
import { publicJwkThumbprint, validateEd25519PublicJwk } from '@/lib/service-auth/jwk'

const valid = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
}

describe('Ed25519 public JWK validation', () => {
  it('accepts only the exact public OKP Ed25519 JWK shape', () => {
    expect(validateEd25519PublicJwk(valid)).toEqual(valid)
  })

  it.each([
    { ...valid, d: 'private-material' },
    { ...valid, kid: 'unexpected' },
    { ...valid, crv: 'X25519' },
    { ...valid, kty: 'EC' },
    { ...valid, x: 'not+base64url' },
    { ...valid, x: valid.x.slice(0, -1) },
    { ...valid, x: `${valid.x}=` },
  ])('rejects non-public, non-canonical, or invalid-length JWK input', (input) => {
    expect(() => validateEd25519PublicJwk(input)).toThrow('Invalid Ed25519 public JWK')
  })

  it('derives the literal RFC 7638 canonical thumbprint vector', () => {
    expect(publicJwkThumbprint(valid)).toBe('P7IdLIpiTZiFaIoOSqbX3JrSyps3hvZ4Y2SieP96XIY')
  })
})
