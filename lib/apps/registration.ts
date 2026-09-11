import { and, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent } from '@/lib/audit/events'
import { getDb, type Db } from '@/lib/db'
import { appCredentials, appNotificationPolicies, sourceApps, supportGroupMembers, supportGroups, supportUsers } from '@/lib/db/schema'
import { requireSafeApplicationBaseUrl } from '@/lib/apps/validation'
import { publicJwkThumbprint, validateEd25519PublicJwk, type Ed25519PublicJwk } from '@/lib/service-auth/jwk'

export interface ApplicationRegistrationInput {
  name: string
  slug: string
  baseUrl: string
  environment: 'production' | 'preview'
  ownerIds: string[]
  publicKey: Ed25519PublicJwk
  vercelProjectId: string
  vercelTeamId: string
}

export interface ApplicationRegistrationResult {
  created: boolean
  appId: string
  credentialId: string
  keyId: string
}

export type RegistrationErrorCode =
  | 'TEAM_MISMATCH'
  | 'ACTOR_NOT_FOUND'
  | 'ACTOR_FORBIDDEN'
  | 'OWNER_NOT_FOUND'
  | 'SLUG_CONFLICT'
  | 'BINDING_CONFLICT'
  | 'KEY_CONFLICT'

export class ApplicationRegistrationError extends Error {
  constructor(readonly code: RegistrationErrorCode) {
    super(code)
    this.name = 'ApplicationRegistrationError'
  }
}

export async function registerApplication({
  db = getDb(), actorId, configuredTeamId, correlationId, input, now = new Date(),
}: {
  db?: Db
  actorId: string
  configuredTeamId: string
  correlationId: string
  input: ApplicationRegistrationInput
  now?: Date
}): Promise<ApplicationRegistrationResult> {
  const normalized = normalizeInput(input)
  if (normalized.vercelTeamId !== configuredTeamId) throw new ApplicationRegistrationError('TEAM_MISMATCH')
  const thumbprint = publicJwkThumbprint(normalized.publicKey)

  try {
    return await db.transaction(async (tx) => {
      // Every registration takes these locks in slug-then-binding order. This
      // serializes same-slug retries and prevents one project/environment from
      // being registered under two slugs.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`registration:slug:${normalized.slug}`}, 0))`)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`registration:binding:${normalized.vercelTeamId}:${normalized.vercelProjectId}:${normalized.environment}`}, 0))`)

      const actor = (await tx.execute<{ id: string; role: string; status: string } & Record<string, unknown>>(sql`
        select id, role, status from support_users where id = ${actorId} for update
      `)).rows[0]
      if (!actor) throw new ApplicationRegistrationError('ACTOR_NOT_FOUND')
      if (actor.status !== 'ACTIVE' || actor.role !== 'ADMIN') throw new ApplicationRegistrationError('ACTOR_FORBIDDEN')

      const ownerRows = await tx.select({ id: supportUsers.id }).from(supportUsers)
        .where(and(eq(supportUsers.status, 'ACTIVE'), inArray(supportUsers.id, normalized.ownerIds)))
      if (ownerRows.length !== normalized.ownerIds.length) throw new ApplicationRegistrationError('OWNER_NOT_FOUND')

      const existingSlug = (await tx.execute<ExistingApp & Record<string, unknown>>(sql`
        select id, slug, status, enrollment_status as "enrollmentStatus", credential_mode as "credentialMode",
               metadata, technical_group_id as "technicalGroupId"
          from source_apps where slug = ${normalized.slug} for update
      `)).rows[0]
      const existingBinding = (await tx.execute<ExistingApp & Record<string, unknown>>(sql`
        select id, slug, status, enrollment_status as "enrollmentStatus", credential_mode as "credentialMode",
               metadata, technical_group_id as "technicalGroupId"
          from source_apps
         where metadata->'registration'->>'vercelProjectId' = ${normalized.vercelProjectId}
           and metadata->'registration'->>'vercelTeamId' = ${normalized.vercelTeamId}
           and environment = ${normalized.environment}
         for update
      `)).rows

      const sameBinding = existingBinding.find((app) => registrationMetadataMatches(app.metadata, normalized))
      if (sameBinding && sameBinding.slug !== normalized.slug) throw new ApplicationRegistrationError('BINDING_CONFLICT')
      if (existingSlug && (!sameBinding || existingSlug.id !== sameBinding.id)) {
        throw new ApplicationRegistrationError('SLUG_CONFLICT')
      }
      if (sameBinding) {
        const credential = (await tx.execute<ExistingCredential & Record<string, unknown>>(sql`
          select id, status, valid_from as "validFrom", valid_until as "validUntil", revoked_at as "revokedAt"
            from app_credentials
           where source_app_id = ${sameBinding.id} and public_key_thumbprint = ${thumbprint}
           for update
        `)).rows[0]
        const valid = credential && credential.status === 'ACTIVE' && !credential.revokedAt
          && new Date(credential.validFrom).getTime() <= now.getTime()
          && (!credential.validUntil || new Date(credential.validUntil).getTime() > now.getTime())
        if (sameBinding.status === 'ACTIVE' && sameBinding.enrollmentStatus === 'ACTIVE'
          && sameBinding.credentialMode === 'PUBLIC_KEY' && valid) {
          return { created: false, appId: sameBinding.id, credentialId: credential.id, keyId: thumbprint }
        }
        // Existing pending, paused, revoked, legacy, or otherwise unusable
        // registrations are never revived or overwritten by a bootstrap retry.
        throw new ApplicationRegistrationError(credential ? 'KEY_CONFLICT' : 'BINDING_CONFLICT')
      }

      const appId = nanoid()
      const credentialId = nanoid()
      const groupId = nanoid()
      const metadata = {
        registration: {
          vercelProjectId: normalized.vercelProjectId,
          vercelTeamId: normalized.vercelTeamId,
        },
      }
      await tx.insert(supportGroups).values({
        id: groupId, name: `${normalized.name} owners (${normalized.slug})`, status: 'ACTIVE', isCentralFallback: false,
        createdAt: now, updatedAt: now,
      })
      await tx.insert(sourceApps).values({
        id: appId, slug: normalized.slug, name: normalized.name, baseUrl: normalized.baseUrl,
        environment: normalized.environment, status: 'ACTIVE', enrollmentStatus: 'ACTIVE', credentialMode: 'PUBLIC_KEY',
        technicalGroupId: groupId, metadata, createdAt: now, updatedAt: now,
      })
      await tx.insert(supportGroupMembers).values(normalized.ownerIds.map((supportUserId) => ({
        id: nanoid(), groupId, supportUserId, recipientRef: null, role: 'OWNER', status: 'ACTIVE', createdAt: now, updatedAt: now,
      })))
      await tx.insert(appNotificationPolicies).values({
        id: nanoid(), sourceAppId: appId, minimumPriority: 'MEDIUM', urgentCentralCopy: true, fallbackToCentral: true,
        createdAt: now, updatedAt: now,
      })
      await tx.insert(appCredentials).values({
        id: credentialId, sourceAppId: appId, publicJwk: { ...normalized.publicKey }, publicKeyThumbprint: thumbprint,
        status: 'ACTIVE', validFrom: now, validUntil: null, revokedAt: null, revokedByUserId: null, rotationParentId: null,
        createdAt: now,
      })
      await appendAuditEvent({
        db: tx, actorType: 'USER', actorId, correlationId, reason: 'Registered application from trusted bootstrap',
        action: 'APP_REGISTRATION_CREATED', subjectType: 'source_app', subjectId: appId,
        metadata: { environment: normalized.environment, ownerCount: normalized.ownerIds.length, vercelProjectId: normalized.vercelProjectId, vercelTeamId: normalized.vercelTeamId }, now,
      })
      return { created: true, appId, credentialId, keyId: thumbprint }
    })
  } catch (error) {
    if (error instanceof ApplicationRegistrationError) throw error
    if (isUniqueViolation(error, 'app_credentials_thumbprint_idx')) throw new ApplicationRegistrationError('KEY_CONFLICT')
    if (isUniqueViolation(error, 'source_apps_slug_idx')) throw new ApplicationRegistrationError('SLUG_CONFLICT')
    throw error
  }
}

function normalizeInput(input: ApplicationRegistrationInput): ApplicationRegistrationInput {
  const name = input.name.trim()
  const slug = input.slug.trim()
  const baseUrl = requireSafeApplicationBaseUrl(input.baseUrl)
  const ownerIds = [...new Set(input.ownerIds.map((id) => id.trim()))]
  if (!name || !slug || !baseUrl || ownerIds.length === 0 || ownerIds.some((id) => !id)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || (ownerIds.length !== input.ownerIds.length)
    || (input.environment !== 'production' && input.environment !== 'preview')) {
    throw new Error('Invalid application registration')
  }
  return {
    ...input, name, slug, baseUrl, ownerIds,
    vercelProjectId: input.vercelProjectId.trim(), vercelTeamId: input.vercelTeamId.trim(),
    publicKey: validateEd25519PublicJwk(input.publicKey),
  }
}

interface ExistingApp {
  id: string
  slug: string
  status: string
  enrollmentStatus: string
  credentialMode: string
  metadata: unknown
  technicalGroupId: string | null
}

interface ExistingCredential {
  id: string
  status: string
  validFrom: Date | string
  validUntil: Date | string | null
  revokedAt: Date | string | null
}

function registrationMetadataMatches(metadata: unknown, input: ApplicationRegistrationInput): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const registration = (metadata as { registration?: unknown }).registration
  if (!registration || typeof registration !== 'object') return false
  const row = registration as { vercelProjectId?: unknown; vercelTeamId?: unknown }
  return row.vercelProjectId === input.vercelProjectId && row.vercelTeamId === input.vercelTeamId
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current && 'constraint' in current
      && (current as { code?: unknown }).code === '23505'
      && (current as { constraint?: unknown }).constraint === constraint) return true
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined
  }
  return false
}
