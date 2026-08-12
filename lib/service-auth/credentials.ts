import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import { sql } from 'drizzle-orm'
import { appendAuditEvent, type AuditActorType } from '@/lib/audit/events'
import { getDb, type Db, type DbTransaction } from '@/lib/db'
import type { ServicePrincipal } from '@/lib/service-auth/assertions'
import { publicJwkThumbprint, validateEd25519PublicJwk, type Ed25519PublicJwk } from '@/lib/service-auth/jwk'

export const ROTATION_PROOF_AUDIENCE = '/api/v1/credentials/rotate'
const ROTATION_CHALLENGE_TTL_MS = 5 * 60_000
const MAX_ROTATION_PROOF_SECONDS = 60
const MAX_OVERLAP_SECONDS = 7 * 24 * 60 * 60
const PROOF_REPLAY_PREFIX = 'rotation-proof:'
const CHALLENGE_REPLAY_PREFIX = 'rotation-challenge:'
const MAX_RETAINED_EXPIRED_ROTATIONS = 20

export type RotationErrorCode =
  | 'INVALID_PROOF'
  | 'INVALID_CHALLENGE'
  | 'ROTATION_IN_PROGRESS'
  | 'DUPLICATE_CREDENTIAL'
  | 'LAST_ACTIVE_CREDENTIAL'
  | 'CREDENTIAL_NOT_FOUND'

export class RotationError extends Error {
  constructor(readonly code: RotationErrorCode) {
    super(code)
    this.name = 'RotationError'
  }
}

export interface RotationChallenge {
  credentialId: string
  challenge: string
  expiresAt: Date
}

export interface RotationConfirmation {
  credentialId: string
  oldCredentialValidUntil: Date
}

export interface ActiveCredential {
  id: string
  sourceAppId: string
  publicJwk: Ed25519PublicJwk
}

export async function getActiveCredential({
  db = getDb(),
  credentialId,
  now = new Date(),
}: {
  db?: Db
  credentialId: string
  now?: Date
}): Promise<ActiveCredential | null> {
  const result = await db.execute<{
    id: string
    sourceAppId: string
    publicJwk: unknown
  } & Record<string, unknown>>(sql`
    select credential.id, credential.source_app_id as "sourceAppId", credential.public_jwk as "publicJwk"
      from app_credentials credential
      join source_apps app on app.id = credential.source_app_id
     where credential.id = ${credentialId}
       and credential.status = 'ACTIVE'
       and credential.revoked_at is null
       and credential.valid_from <= ${now}
       and (credential.valid_until is null or credential.valid_until > ${now})
       and app.status = 'ACTIVE'
       and app.enrollment_status = 'ACTIVE'
       and app.credential_mode = 'PUBLIC_KEY'
     limit 1
  `)
  const credential = result.rows[0]
  if (!credential) return null
  try {
    return { id: credential.id, sourceAppId: credential.sourceAppId, publicJwk: validateEd25519PublicJwk(credential.publicJwk) }
  } catch {
    return null
  }
}

export async function beginCredentialRotation({
  db = getDb(), principal, nextPublicJwk, proof, correlationId, now = new Date(),
  afterPendingCreated, afterAuditAppended, afterDuplicateChecked, afterExpiredRotationsAudited,
  afterPrunedRotationDeleted,
}: {
  db?: Db
  principal: ServicePrincipal
  nextPublicJwk: unknown
  proof: string
  correlationId: string
  now?: Date
  afterPendingCreated?: () => Promise<void>
  afterAuditAppended?: () => Promise<void>
  afterDuplicateChecked?: () => Promise<void>
  afterExpiredRotationsAudited?: () => Promise<void>
  afterPrunedRotationDeleted?: () => Promise<void>
}): Promise<RotationChallenge> {
  if (!principal.scopes.includes('credentials:rotate')) throw new RotationError('INVALID_PROOF')
  const nextJwk = safePublicJwk(nextPublicJwk, 'INVALID_PROOF')
  const nextThumbprint = publicJwkThumbprint(nextJwk)
  const credentialId = randomUUID()
  const challenge = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + ROTATION_CHALLENGE_TTL_MS)

  try {
    return await db.transaction(async (tx) => {
      const app = (await tx.execute<AppRow & Record<string, unknown>>(sql`
        select id, status, enrollment_status as "enrollmentStatus", credential_mode as "credentialMode"
          from source_apps where id = ${principal.appId} for update
      `)).rows[0]
      const current = (await tx.execute<CredentialRow & Record<string, unknown>>(sql`
        select id, source_app_id as "sourceAppId", public_jwk as "publicJwk", status,
               valid_from as "validFrom", valid_until as "validUntil", revoked_at as "revokedAt"
          from app_credentials where id = ${principal.credentialId} for update
      `)).rows[0]
      if (!isUsableApp(app) || !isActiveCredential(current, principal.appId, now)) throw new RotationError('INVALID_PROOF')

      const proofClaims = await verifyRotationProof({
        proof, current, principal, expectedThumbprint: nextThumbprint, now,
      })

      await expireAndPruneRotations({
        tx, appId: principal.appId, correlationId, now,
        afterExpiredRotationsAudited, afterPrunedRotationDeleted,
      })

      const duplicate = await tx.execute(sql`
        select 1 from app_credentials where public_key_thumbprint = ${nextThumbprint} limit 1
      `)
      if (duplicate.rows[0]) throw new RotationError('DUPLICATE_CREDENTIAL')
      await afterDuplicateChecked?.()

      const existing = await tx.execute(sql`
        select 1
          from app_credentials pending
         where pending.rotation_parent_id = ${current.id}
           and pending.status = 'PENDING'
           and pending.valid_until > ${now}
         limit 1
      `)
      if (existing.rows[0]) throw new RotationError('ROTATION_IN_PROGRESS')

      const proofReplay = await tx.execute(sql`
        insert into service_assertion_replays (id, credential_id, assertion_jti, expires_at, created_at)
        values (${randomUUID()}, ${current.id}, ${`${PROOF_REPLAY_PREFIX}${digest(proofClaims.nonce)}`}, ${new Date(proofClaims.exp * 1000)}, ${now})
        on conflict (credential_id, assertion_jti) do nothing
        returning id
      `)
      if (!proofReplay.rows[0]) throw new RotationError('INVALID_PROOF')

      await tx.execute(sql`
        insert into app_credentials
          (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, valid_until, rotation_parent_id, created_at)
        values
          (${credentialId}, ${principal.appId}, ${JSON.stringify(nextJwk)}::jsonb, ${nextThumbprint}, 'PENDING', ${now}, ${expiresAt}, ${current.id}, ${now})
      `)
      await afterPendingCreated?.()
      await tx.execute(sql`
        insert into service_assertion_replays (id, credential_id, assertion_jti, expires_at, created_at)
        values (${randomUUID()}, ${credentialId}, ${`${CHALLENGE_REPLAY_PREFIX}${digest(challenge)}`}, ${expiresAt}, ${now})
      `)
      await appendAuditEvent({
        db: tx, actorType: 'APPLICATION', actorId: principal.appId, correlationId, reason: 'Application credential rotation begun',
        action: 'SERVICE_CREDENTIAL_ROTATION_BEGUN', subjectType: 'app_credential', subjectId: credentialId,
        metadata: { parentCredentialId: current.id }, now,
      })
      await afterAuditAppended?.()
      return { credentialId, challenge, expiresAt }
    })
  } catch (error) {
    if (isThumbprintUniqueViolation(error)) throw new RotationError('DUPLICATE_CREDENTIAL')
    throw error
  }
}

export async function confirmCredentialRotation({
  db = getDb(), principal, credentialId, challenge, signature, overlapSeconds, correlationId, now = new Date(),
  afterActivated, afterAuditAppended,
}: {
  db?: Db
  principal: ServicePrincipal
  credentialId: string
  challenge: string
  signature: string
  overlapSeconds: number
  correlationId: string
  now?: Date
  afterActivated?: () => Promise<void>
  afterAuditAppended?: () => Promise<void>
}): Promise<RotationConfirmation> {
  if (!principal.scopes.includes('credentials:rotate')
    || !credentialId || !challenge || !signature || !Number.isFinite(overlapSeconds) || overlapSeconds < 0) {
    throw new RotationError('INVALID_CHALLENGE')
  }
  const signatureBytes = decodeBase64Url(signature)
  if (!signatureBytes) throw new RotationError('INVALID_CHALLENGE')

  return db.transaction(async (tx) => {
    const app = (await tx.execute<AppRow & Record<string, unknown>>(sql`
      select id, status, enrollment_status as "enrollmentStatus", credential_mode as "credentialMode"
        from source_apps where id = ${principal.appId} for update
    `)).rows[0]
    const current = (await tx.execute<CredentialRow & Record<string, unknown>>(sql`
      select id, source_app_id as "sourceAppId", public_jwk as "publicJwk", status,
             valid_from as "validFrom", valid_until as "validUntil", revoked_at as "revokedAt"
        from app_credentials where id = ${principal.credentialId} for update
    `)).rows[0]
    const pending = (await tx.execute<PendingCredentialRow & Record<string, unknown>>(sql`
      select id, source_app_id as "sourceAppId", public_jwk as "publicJwk", status,
             rotation_parent_id as "rotationParentId", valid_until as "validUntil"
        from app_credentials where id = ${credentialId} for update
    `)).rows[0]
    if (!isUsableApp(app) || !isActiveCredential(current, principal.appId, now)
      || !pending || pending.sourceAppId !== principal.appId || pending.status !== 'PENDING'
      || pending.rotationParentId !== current.id || !pending.validUntil
      || new Date(pending.validUntil).getTime() <= now.getTime()) throw new RotationError('INVALID_CHALLENGE')

    const marker = `${CHALLENGE_REPLAY_PREFIX}${digest(challenge)}`
    const replay = await tx.execute(sql`
      select 1 from service_assertion_replays
       where credential_id = ${pending.id} and assertion_jti = ${marker}
       for update
    `)
    if (!replay.rows[0]) throw new RotationError('INVALID_CHALLENGE')
    const pendingJwk = safePublicJwk(pending.publicJwk, 'INVALID_CHALLENGE')
    try {
      const key = await importJWK(pendingJwk, 'EdDSA')
      const message = new TextEncoder().encode(`support-tower-rotation:${pending.id}:${challenge}`)
      if (!(await crypto.subtle.verify('Ed25519', key as CryptoKey, signatureBytes, message))) throw new Error('invalid signature')
    } catch { throw new RotationError('INVALID_CHALLENGE') }

    const boundedOverlap = Math.min(Math.floor(overlapSeconds), MAX_OVERLAP_SECONDS)
    const requestedExpiry = new Date(now.getTime() + boundedOverlap * 1_000)
    const existingExpiry = current.validUntil ? new Date(current.validUntil) : null
    const oldCredentialValidUntil = existingExpiry && existingExpiry < requestedExpiry ? existingExpiry : requestedExpiry
    await tx.execute(sql`
      update app_credentials set status = 'ACTIVE', valid_from = ${now}, valid_until = null
       where id = ${pending.id}
    `)
    await tx.execute(sql`
      update app_credentials set valid_until = ${oldCredentialValidUntil}
       where id = ${current.id}
    `)
    await tx.execute(sql`
      delete from service_assertion_replays
       where credential_id = ${pending.id} and assertion_jti = ${marker}
    `)
    await afterActivated?.()
    await appendAuditEvent({
      db: tx, actorType: 'APPLICATION', actorId: principal.appId, correlationId, reason: 'Application credential rotation confirmed',
      action: 'SERVICE_CREDENTIAL_ROTATION_CONFIRMED', subjectType: 'app_credential', subjectId: pending.id,
      metadata: { parentCredentialId: current.id, overlapSeconds: boundedOverlap }, now,
    })
    await afterAuditAppended?.()
    return { credentialId: pending.id, oldCredentialValidUntil }
  })
}

export async function revokeCredential({
  db = getDb(), appId, credentialId, actorId, actorType = 'USER', correlationId, now = new Date(), afterRevoked,
}: {
  db?: Db
  appId: string
  credentialId: string
  actorId: string
  actorType?: AuditActorType
  correlationId: string
  now?: Date
  afterRevoked?: () => Promise<void>
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const app = (await tx.execute<AppRow & Record<string, unknown>>(sql`
      select id, status, enrollment_status as "enrollmentStatus", credential_mode as "credentialMode"
        from source_apps where id = ${appId} for update
    `)).rows[0]
    if (!app) throw new RotationError('CREDENTIAL_NOT_FOUND')
    const credentials = await tx.execute<RevocationRow & Record<string, unknown>>(sql`
      select id, status, valid_from as "validFrom", valid_until as "validUntil", revoked_at as "revokedAt"
        from app_credentials where source_app_id = ${appId} order by id for update
    `)
    const target = credentials.rows.find((credential) => credential.id === credentialId)
    if (!target || target.status === 'REVOKED' || target.revokedAt) throw new RotationError('CREDENTIAL_NOT_FOUND')
    const targetIsActive = isWithinValidity(target, now)
    const activeCount = credentials.rows.filter((credential) => isWithinValidity(credential, now)).length
    const appCanHaveNoActiveCredential = app.status === 'PAUSED'
      || app.enrollmentStatus === 'PAUSED'
      || app.enrollmentStatus === 'REVOKED'
    if (targetIsActive && activeCount <= 1 && !appCanHaveNoActiveCredential) throw new RotationError('LAST_ACTIVE_CREDENTIAL')
    await tx.execute(sql`
      update app_credentials set status = 'REVOKED', revoked_at = ${now}, valid_until = ${now}
       where id = ${credentialId}
    `)
    await afterRevoked?.()
    await appendAuditEvent({
      db: tx, actorType, actorId, correlationId, reason: 'Application credential revoked',
      action: 'SERVICE_CREDENTIAL_REVOKED', subjectType: 'app_credential', subjectId: credentialId, now,
    })
    return true
  })
}

interface AppRow {
  id: string
  status: string
  enrollmentStatus: string
  credentialMode: string
}

interface CredentialRow {
  id: string
  sourceAppId: string
  publicJwk: unknown
  status: string
  validFrom: Date | string
  validUntil: Date | string | null
  revokedAt: Date | string | null
}

interface PendingCredentialRow {
  id: string
  sourceAppId: string
  publicJwk: unknown
  status: string
  rotationParentId: string | null
  validUntil: Date | string | null
}

interface RevocationRow {
  id: string
  status: string
  validFrom: Date | string
  validUntil: Date | string | null
  revokedAt: Date | string | null
}

function isUsableApp(app: AppRow | undefined): app is AppRow {
  return Boolean(app && app.status === 'ACTIVE' && app.enrollmentStatus === 'ACTIVE' && app.credentialMode === 'PUBLIC_KEY')
}

function isActiveCredential(credential: CredentialRow | undefined, appId: string, now: Date): credential is CredentialRow {
  return Boolean(credential && credential.sourceAppId === appId && isWithinValidity(credential, now))
}

function isWithinValidity(credential: RevocationRow, now: Date): boolean {
  return credential.status === 'ACTIVE' && !credential.revokedAt
    && new Date(credential.validFrom).getTime() <= now.getTime()
    && (!credential.validUntil || new Date(credential.validUntil).getTime() > now.getTime())
}

async function verifyRotationProof({
  proof, current, principal, expectedThumbprint, now,
}: {
  proof: string
  current: CredentialRow
  principal: ServicePrincipal
  expectedThumbprint: string
  now: Date
}): Promise<{ nonce: string; exp: number }> {
  try {
    const header = decodeProtectedHeader(proof)
    if (header.alg !== 'EdDSA' || header.kid !== current.id) throw new Error('invalid header')
    const key = await importJWK(validateEd25519PublicJwk(current.publicJwk), 'EdDSA')
    const { payload } = await jwtVerify(proof, key, {
      algorithms: ['EdDSA'], audience: ROTATION_PROOF_AUDIENCE, currentDate: now,
      maxTokenAge: MAX_ROTATION_PROOF_SECONDS,
    })
    const expectedKeys = ['appId', 'aud', 'currentCredentialId', 'exp', 'iat', 'nextJwkThumbprint', 'nonce']
    if (Object.keys(payload).sort().join(',') !== expectedKeys.join(',')
      || payload.appId !== principal.appId || payload.currentCredentialId !== principal.credentialId
      || payload.nextJwkThumbprint !== expectedThumbprint
      || typeof payload.nonce !== 'string' || !payload.nonce.trim() || payload.nonce.length > 200
      || typeof payload.iat !== 'number' || typeof payload.exp !== 'number'
      || payload.iat > Math.floor(now.getTime() / 1_000)
      || payload.exp <= payload.iat || payload.exp - payload.iat > MAX_ROTATION_PROOF_SECONDS) throw new Error('invalid claims')
    return { nonce: payload.nonce, exp: payload.exp }
  } catch {
    throw new RotationError('INVALID_PROOF')
  }
}

function safePublicJwk(value: unknown, code: 'INVALID_PROOF' | 'INVALID_CHALLENGE'): Ed25519PublicJwk {
  try { return validateEd25519PublicJwk(value) } catch { throw new RotationError(code) }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function expireAndPruneRotations({
  tx, appId, correlationId, now, afterExpiredRotationsAudited, afterPrunedRotationDeleted,
}: {
  tx: DbTransaction
  appId: string
  correlationId: string
  now: Date
  afterExpiredRotationsAudited?: () => Promise<void>
  afterPrunedRotationDeleted?: () => Promise<void>
}): Promise<void> {
  const expired = await tx.execute<{ id: string } & Record<string, unknown>>(sql`
    update app_credentials
       set status = 'EXPIRED'
     where source_app_id = ${appId}
       and status = 'PENDING'
       and valid_until <= ${now}
     returning id
  `)
  for (const credential of expired.rows) {
    await appendAuditEvent({
      db: tx, actorType: 'APPLICATION', actorId: appId, correlationId, reason: 'Pending credential rotation expired',
      action: 'SERVICE_CREDENTIAL_ROTATION_EXPIRED', subjectType: 'app_credential', subjectId: credential.id, now,
    })
  }
  await afterExpiredRotationsAudited?.()
  const prunable = await tx.execute<{ id: string } & Record<string, unknown>>(sql`
    with ranked as (
      select id, row_number() over (order by created_at desc, id desc) as position
        from app_credentials
       where source_app_id = ${appId}
         and status = 'EXPIRED'
         and rotation_parent_id is not null
    )
    select id from ranked where position > ${MAX_RETAINED_EXPIRED_ROTATIONS}
  `)
  for (const credential of prunable.rows) {
    await appendAuditEvent({
      db: tx, actorType: 'APPLICATION', actorId: appId, correlationId, reason: 'Expired credential rotation pruned by retention policy',
      action: 'SERVICE_CREDENTIAL_ROTATION_PRUNED', subjectType: 'app_credential', subjectId: credential.id, now,
    })
    await tx.execute(sql`
      delete from app_credentials where id = ${credential.id} and source_app_id = ${appId} and status = 'EXPIRED'
    `)
    await afterPrunedRotationDeleted?.()
  }
}

function isThumbprintUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const postgres = current as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (postgres.code === '23505' && postgres.constraint === 'app_credentials_thumbprint_idx') return true
    current = postgres.cause
  }
  return false
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === 64 && bytes.toString('base64url') === value ? Uint8Array.from(bytes) : null
}
