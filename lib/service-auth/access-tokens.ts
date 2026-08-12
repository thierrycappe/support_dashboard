import { importJWK, jwtVerify, SignJWT } from 'jose'
import { getActiveCredential } from '@/lib/service-auth/credentials'
import type { ServicePrincipal, ServiceScope } from '@/lib/service-auth/assertions'

export const SERVICE_ACCESS_TOKEN_ISSUER = 'support-tower'
export const SERVICE_ACCESS_TOKEN_AUDIENCE = 'support-tower-service'
const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 5 * 60
const allowedScopes = new Set<ServiceScope>(['escalations:write', 'credentials:rotate'])

export async function issueServiceAccessToken({
  principal,
  now = new Date(),
  expiresInSeconds = MAX_ACCESS_TOKEN_LIFETIME_SECONDS,
  privateJwk = loadPrivateJwk(),
}: {
  principal: ServicePrincipal
  now?: Date
  expiresInSeconds?: number
  privateJwk?: Record<string, unknown>
}): Promise<string> {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > MAX_ACCESS_TOKEN_LIFETIME_SECONDS) {
    throw new Error('Invalid service access token lifetime')
  }
  const key = await importJWK(privateJwk, 'EdDSA')
  const issuedAt = Math.floor(now.getTime() / 1000)
  return new SignJWT({ appId: principal.appId, credentialId: principal.credentialId, scope: principal.scopes })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(SERVICE_ACCESS_TOKEN_ISSUER)
    .setAudience(SERVICE_ACCESS_TOKEN_AUDIENCE)
    .setSubject(principal.appId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + expiresInSeconds)
    .sign(key)
}

export async function verifyServiceAccessToken({
  token,
  now = new Date(),
  privateJwk = loadPrivateJwk(),
  getCredential = getActiveCredential,
}: {
  token: string
  now?: Date
  privateJwk?: Record<string, unknown>
  getCredential?: typeof getActiveCredential
}): Promise<ServicePrincipal> {
  try {
    const key = await importJWK(publicJwkFromPrivate(privateJwk), 'EdDSA')
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['EdDSA'], issuer: SERVICE_ACCESS_TOKEN_ISSUER, audience: SERVICE_ACCESS_TOKEN_AUDIENCE,
      currentDate: now, maxTokenAge: MAX_ACCESS_TOKEN_LIFETIME_SECONDS, clockTolerance: 5,
    })
    if (typeof payload.appId !== 'string' || typeof payload.credentialId !== 'string'
      || payload.sub !== payload.appId || typeof payload.iat !== 'number' || typeof payload.exp !== 'number'
      || payload.exp - payload.iat > MAX_ACCESS_TOKEN_LIFETIME_SECONDS) throw new Error('invalid claims')
    const scopes = parseScopes(payload.scope)
    const credential = await getCredential({ credentialId: payload.credentialId, now })
    if (!credential || credential.sourceAppId !== payload.appId) throw new Error('inactive credential')
    return { appId: payload.appId, credentialId: payload.credentialId, scopes }
  } catch {
    throw new Error('Invalid service access token')
  }
}

function loadPrivateJwk(env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  const encoded = env.SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK
  if (!encoded) throw new Error('Invalid service access token')
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('d' in parsed)) throw new Error('invalid JWK')
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('Invalid service access token')
  }
}

function publicJwkFromPrivate(privateJwk: Record<string, unknown>): Record<string, unknown> {
  const publicJwk = { ...privateJwk }
  delete publicJwk.d
  return publicJwk
}

function parseScopes(value: unknown): ServiceScope[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(' ') : []
  if (raw.length === 0 || raw.some((scope) => typeof scope !== 'string' || !allowedScopes.has(scope as ServiceScope))) throw new Error('invalid scope')
  return [...new Set(raw as ServiceScope[])]
}
