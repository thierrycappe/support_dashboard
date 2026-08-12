import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { consumeInvitation, createInvitation, revokeInvitation } from '@/lib/service-auth/invitations'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:00.000Z')

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps cascade`)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values ('invite-app', 'invite-app', 'Invitation app', 'test', 'ACTIVE', 'PENDING', 'PUBLIC_KEY', ${now}, ${now})
  `)
})

afterAll(async () => { await closeDbPool() })

describe('application enrollment invitations', () => {
  it('stores only a SHA-256 digest and an eight-character prefix for a random 32-byte one-time secret', async () => {
    const created = await createInvitation({ db: getDb(), sourceAppId: 'invite-app', now })
    const row = await getDb().execute<{ tokenDigest: string; tokenPrefix: string; expiresAt: Date | string; serialized: Record<string, unknown> }>(sql`
      select token_digest as "tokenDigest", token_prefix as "tokenPrefix", expires_at as "expiresAt", row_to_json(app_enrollment_grants) as serialized
        from app_enrollment_grants where id = ${created.id}
    `)

    expect(Buffer.from(created.secret, 'base64url')).toHaveLength(32)
    expect(created.expiresAt).toEqual(new Date(now.getTime() + 30 * 60_000))
    expect(row.rows[0]).toMatchObject({
      tokenDigest: createHash('sha256').update(created.secret, 'utf8').digest('hex'),
      tokenPrefix: created.secret.slice(0, 8),
    })
    expect(asDate(row.rows[0]!.expiresAt)).toEqual(created.expiresAt)
    expect(JSON.stringify(row.rows[0]?.serialized)).not.toContain(created.secret)
  })

  it('allows exactly one concurrent consumption and marks the grant consumed', async () => {
    const created = await createInvitation({ db: getDb(), sourceAppId: 'invite-app', now })
    const results = await Promise.allSettled([
      consumeInvitation({ db: getDb(), secret: created.secret, now }),
      consumeInvitation({ db: getDb(), secret: created.secret, now }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const consumed = await getDb().execute<{ consumedAt: Date | string | null }>(sql`
      select consumed_at as "consumedAt" from app_enrollment_grants where id = ${created.id}
    `)
    expect(asDate(consumed.rows[0]!.consumedAt!)).toEqual(now)
  })

  it('rejects expired and revoked invitations without consuming them', async () => {
    const expired = await createInvitation({ db: getDb(), sourceAppId: 'invite-app', now })
    await expect(consumeInvitation({ db: getDb(), secret: expired.secret, now: new Date(now.getTime() + 30 * 60_000) })).rejects.toThrow('Invitation is no longer valid')

    const revoked = await createInvitation({ db: getDb(), sourceAppId: 'invite-app', now })
    await expect(revokeInvitation({ db: getDb(), id: revoked.id, now })).resolves.toBe(true)
    await expect(consumeInvitation({ db: getDb(), secret: revoked.secret, now })).rejects.toThrow('Invitation is no longer valid')
  })
})

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
