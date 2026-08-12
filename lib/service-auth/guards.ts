import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent } from '@/lib/audit/events'
import { getDb, type Db, type DbTransaction } from '@/lib/db'
import type { ServicePrincipal, ServiceScope } from '@/lib/service-auth/assertions'
import { verifyServiceAccessToken } from '@/lib/service-auth/access-tokens'
import { invitationDigest, invitationDigestMatches } from '@/lib/service-auth/invitations'
import { publicJwkThumbprint, validateEd25519PublicJwk } from '@/lib/service-auth/jwk'
import { consumeRequiredLimits, getTrustedClientIp, serviceRateLimits } from '@/lib/service-auth/rate-limit'

export class RequestBodyError extends Error {
  constructor(readonly kind: 'invalid' | 'too_large') { super(kind) }
}

export class UnsupportedMediaTypeError extends Error {}
export class ServiceAuthorizationError extends Error {}

export function publicError(status: number, code: string, message: string, correlationId: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message, correlationId } }, { status, headers: noStoreHeaders(headers) })
}

export function publicJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: noStoreHeaders(init.headers) })
}

export function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type')
  if (!contentType || contentType.split(';', 1)[0]!.trim().toLowerCase() !== 'application/json') {
    throw new UnsupportedMediaTypeError()
  }
}

export function requestCorrelationId(request: Request): string {
  const supplied = request.headers.get('x-correlation-id')?.trim()
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID()
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyError('too_large')
  if (!request.body) throw new RequestBodyError('invalid')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        try { await reader.cancel() } catch { /* body is already rejected */ }
        throw new RequestBodyError('too_large')
      }
      chunks.push(chunk.value)
    }
    const payload = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as unknown
  } catch (error) {
    if (error instanceof RequestBodyError) throw error
    throw new RequestBodyError('invalid')
  }
}

export function requireIdempotencyKey(headers: Headers): string {
  const key = headers.get('idempotency-key')?.trim()
  if (!key || key.length > 200) throw new RequestBodyError('invalid')
  return key
}

export async function requireServicePrincipal(request: Request, scopes: ServiceScope[]): Promise<ServicePrincipal> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length <= 7) throw new ServiceAuthorizationError()
  const principal = await verifyServiceAccessToken({ token: authorization.slice(7) })
  if (scopes.some((scope) => !principal.scopes.includes(scope))) throw new ServiceAuthorizationError()
  return principal
}

export interface EnrollmentExchangeResult {
  kind: 'created' | 'invalid'
  appId?: string
  credentialId?: string
  keyId?: string
}

export async function exchangeEnrollment({
  db = getDb(), grantId, invitation, publicJwk, clientIp, correlationId, now = new Date(),
  afterAppLocked, afterCredentialCreated, afterAuditAppended,
}: {
  db?: Db
  grantId: string
  invitation: string
  publicJwk: unknown
  clientIp: string
  correlationId: string
  now?: Date
  afterAppLocked?: () => Promise<void>
  afterCredentialCreated?: () => Promise<void>
  afterAuditAppended?: () => Promise<void>
}): Promise<EnrollmentExchangeResult> {
  const jwk = validateEd25519PublicJwk(publicJwk)
  const digest = invitationDigest(invitation).toString('hex')
  const thumbprint = publicJwkThumbprint(jwk)
  return db.transaction(async (tx) => {
    const owner = await tx.execute<{ sourceAppId: string } & Record<string, unknown>>(sql`
      select source_app_id as "sourceAppId" from app_enrollment_grants where id = ${grantId}
    `)
    if (!owner.rows[0]) return { kind: 'invalid' }
    const apps = await tx.execute<{
      id: string; appStatus: string; enrollmentStatus: string; credentialMode: string
    } & Record<string, unknown>>(sql`
      select id, status as "appStatus", enrollment_status as "enrollmentStatus", credential_mode as "credentialMode"
        from source_apps where id = ${owner.rows[0].sourceAppId} for update
    `)
    const app = apps.rows[0]
    if (!app) return { kind: 'invalid' }
    await afterAppLocked?.()
    if (app.appStatus !== 'ACTIVE' || app.enrollmentStatus !== 'PENDING' || app.credentialMode !== 'LEGACY_BEARER') {
      return { kind: 'invalid' }
    }
    await consumeRequiredLimits(tx, [
      { scope: 'enrollment:invitation', subject: digest, ...serviceRateLimits.enrollmentInvitation, now },
      { scope: 'enrollment:ip', subject: clientIp, ...serviceRateLimits.enrollmentIp, now },
    ])
    const grants = await tx.execute<{
      id: string; sourceAppId: string; tokenDigest: string; expiresAt: Date; consumedAt: Date | null; revokedAt: Date | null
    } & Record<string, unknown>>(sql`
      select id, source_app_id as "sourceAppId", token_digest as "tokenDigest", expires_at as "expiresAt",
             consumed_at as "consumedAt", revoked_at as "revokedAt"
        from app_enrollment_grants where id = ${grantId} and source_app_id = ${app.id} for update
    `)
    const grant = grants.rows[0]
    if (!grant || !invitationDigestMatches(invitation, grant.tokenDigest) || grant.consumedAt || grant.revokedAt || grant.expiresAt <= now) {
      return { kind: 'invalid' }
    }
    const credentialId = nanoid()
    await tx.execute(sql`
      insert into app_credentials (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, created_at)
      values (${credentialId}, ${grant.sourceAppId}, ${JSON.stringify(jwk)}::jsonb, ${thumbprint}, 'ACTIVE', ${now}, ${now})
    `)
    await afterCredentialCreated?.()
    await tx.execute(sql`
      update source_apps set status = 'ACTIVE', enrollment_status = 'ACTIVE', credential_mode = 'PUBLIC_KEY',
        last_authenticated_at = ${now}, updated_at = ${now} where id = ${grant.sourceAppId}
    `)
    await tx.execute(sql`update app_enrollment_grants set consumed_at = ${now} where id = ${grant.id}`)
    await appendAuditEvent({
      db: tx, actorId: grant.sourceAppId, correlationId, reason: 'Application enrollment exchanged',
      action: 'SERVICE_APP_ENROLLED', subjectType: 'source_app', subjectId: grant.sourceAppId,
      metadata: { credentialId }, now,
    })
    await afterAuditAppended?.()
    return { kind: 'created', appId: grant.sourceAppId, credentialId, keyId: thumbprint }
  })
}

export function invitationRateSubject(invitation: string): string {
  return createHash('sha256').update(invitation, 'utf8').digest('hex')
}

export { getTrustedClientIp }

export type ServiceDbExecutor = Db | DbTransaction

function noStoreHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  result.set('Cache-Control', 'no-store')
  return result
}
