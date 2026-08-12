import { randomUUID } from 'node:crypto'
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'
import { getActiveCredential } from '@/lib/service-auth/credentials'

export type ServiceScope = 'escalations:write' | 'credentials:rotate'

export interface ServicePrincipal {
  appId: string
  credentialId: string
  scopes: ServiceScope[]
}

const CLOCK_TOLERANCE_SECONDS = 5
const MAX_ASSERTION_LIFETIME_SECONDS = 60
const allowedScopes = new Set<ServiceScope>(['escalations:write', 'credentials:rotate'])

export async function verifyClientAssertion({
  db = getDb(),
  assertion,
  audience,
  now = new Date(),
  getCredential = getActiveCredential,
  recordReplay = recordAssertionReplay,
}: {
  db?: Db
  assertion: string
  audience: string
  now?: Date
  getCredential?: typeof getActiveCredential
  recordReplay?: typeof recordAssertionReplay
}): Promise<ServicePrincipal> {
  try {
    const header = decodeProtectedHeader(assertion)
    if (header.alg !== 'EdDSA' || typeof header.kid !== 'string' || !header.kid) throw new Error('invalid header')
    const credential = await getCredential({ db, credentialId: header.kid, now })
    if (!credential) throw new Error('inactive credential')
    const key = await importJWK(credential.publicJwk, 'EdDSA')
    const { payload } = await jwtVerify(assertion, key, {
      algorithms: ['EdDSA'],
      audience,
      issuer: credential.sourceAppId,
      subject: credential.sourceAppId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
      maxTokenAge: MAX_ASSERTION_LIFETIME_SECONDS,
    })
    if (payload.iss !== payload.sub || payload.iss !== credential.sourceAppId
      || typeof payload.jti !== 'string' || !payload.jti.trim()
      || typeof payload.iat !== 'number' || typeof payload.exp !== 'number'
      || payload.exp - payload.iat > MAX_ASSERTION_LIFETIME_SECONDS) throw new Error('invalid claims')
    const scopes = parseScopes(payload.scope)
    await recordReplay({ db, credentialId: credential.id, jti: payload.jti, expiresAt: new Date(payload.exp * 1000), now })
    return { appId: credential.sourceAppId, credentialId: credential.id, scopes }
  } catch {
    throw new Error('Invalid client assertion')
  }
}

export async function recordAssertionReplay({
  db = getDb(),
  credentialId,
  jti,
  expiresAt,
  now = new Date(),
}: {
  db?: Db
  credentialId: string
  jti: string
  expiresAt: Date
  now?: Date
}): Promise<void> {
  const inserted = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    insert into service_assertion_replays (id, credential_id, assertion_jti, expires_at, created_at)
      values (${randomUUID()}, ${credentialId}, ${jti}, ${expiresAt}, ${now})
      on conflict (credential_id, assertion_jti) do nothing
      returning id
  `)
  if (!inserted.rows[0]) throw new Error('Assertion replayed')
}

function parseScopes(value: unknown): ServiceScope[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(' ') : []
  if (raw.length === 0 || raw.some((scope) => typeof scope !== 'string' || !allowedScopes.has(scope as ServiceScope))) {
    throw new Error('invalid scope')
  }
  return [...new Set(raw as ServiceScope[])]
}
