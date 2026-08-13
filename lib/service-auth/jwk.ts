import { createHash } from 'node:crypto'
import { z } from 'zod'

export interface Ed25519PublicJwk {
  kty: 'OKP'
  crv: 'Ed25519'
  x: string
}

const publicJwkSchema = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).strict()

export function validateEd25519PublicJwk(value: unknown): Ed25519PublicJwk {
  const parsed = publicJwkSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid Ed25519 public JWK')
  const bytes = Buffer.from(parsed.data.x, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== parsed.data.x) {
    throw new Error('Invalid Ed25519 public JWK')
  }
  return parsed.data
}

export function publicJwkThumbprint(value: unknown): string {
  const jwk = validateEd25519PublicJwk(value)
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`
  return createHash('sha256').update(canonical, 'utf8').digest('base64url')
}
