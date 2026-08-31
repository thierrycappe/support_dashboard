import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb, type Db } from '@/lib/db'

const INVITATION_SECRET_BYTES = 32
const INVITATION_TTL_MS = 30 * 60_000

export interface CreatedInvitation {
  id: string
  secret: string
  expiresAt: Date
}

export interface ConsumedInvitation {
  id: string
  sourceAppId: string
  expiresAt: Date
}

export function invitationDigest(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function invitationDigestMatches(secret: string, persistedDigest: string): boolean {
  const actual = invitationDigest(secret)
  const parsed = /^[a-f0-9]{64}$/i.test(persistedDigest)
    ? Buffer.from(persistedDigest, 'hex')
    : Buffer.alloc(0)
  const expected = Buffer.alloc(actual.length)
  parsed.copy(expected, 0, 0, expected.length)
  const sameLength = parsed.length === expected.length
  return timingSafeEqual(actual, expected) && sameLength
}

export async function createInvitation({
  db = getDb(),
  sourceAppId,
  createdByUserId = null,
  now = new Date(),
}: {
  db?: Db
  sourceAppId: string
  createdByUserId?: string | null
  now?: Date
}): Promise<CreatedInvitation> {
  const secret = randomBytes(INVITATION_SECRET_BYTES).toString('base64url')
  const invitation: CreatedInvitation = {
    id: nanoid(),
    secret,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
  }
  await db.execute(sql`
    insert into app_enrollment_grants (
      id, source_app_id, token_digest, token_prefix, expires_at, created_by_user_id, created_at
    ) values (
      ${invitation.id}, ${sourceAppId}, ${invitationDigest(secret).toString('hex')}, ${secret.slice(0, 8)},
      ${invitation.expiresAt}, ${createdByUserId}, ${now}
    )
  `)
  return invitation
}

export async function consumeInvitation({
  db = getDb(),
  secret,
  now = new Date(),
}: {
  db?: Db
  secret: string
  now?: Date
}): Promise<ConsumedInvitation> {
  const digest = invitationDigest(secret).toString('hex')
  return db.transaction(async (tx) => {
    const found = await tx.execute<{
      id: string
      sourceAppId: string
      tokenDigest: string
      expiresAt: Date
      consumedAt: Date | null
      revokedAt: Date | null
    } & Record<string, unknown>>(sql`
      select id, source_app_id as "sourceAppId", token_digest as "tokenDigest", expires_at as "expiresAt",
        consumed_at as "consumedAt", revoked_at as "revokedAt"
        from app_enrollment_grants
       where token_digest = ${digest}
       for update
    `)
    const grant = found.rows[0]
    if (!grant || !invitationDigestMatches(secret, grant.tokenDigest)
      || grant.consumedAt !== null || grant.revokedAt !== null || grant.expiresAt <= now) {
      throw new Error('Invitation is no longer valid')
    }

    const consumed = await tx.execute<ConsumedInvitation & Record<string, unknown>>(sql`
      update app_enrollment_grants
         set consumed_at = ${now}
       where id = ${grant.id}
         and consumed_at is null
         and revoked_at is null
         and expires_at > ${now}
       returning id, source_app_id as "sourceAppId", expires_at as "expiresAt"
    `)
    const result = consumed.rows[0]
    if (!result) throw new Error('Invitation is no longer valid')
    return result
  })
}

export async function revokeInvitation({
  db = getDb(),
  id,
  now = new Date(),
}: {
  db?: Db
  id: string
  now?: Date
}): Promise<boolean> {
  // Revocation is actionable only while this grant can still be consumed.
  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    update app_enrollment_grants
       set revoked_at = ${now}
     where id = ${id}
       and consumed_at is null
       and revoked_at is null
       and expires_at > ${now}
     returning id
  `)
  return result.rows.length === 1
}
