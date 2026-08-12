import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { verifyClientAssertion } from '@/lib/service-auth/assertions'
import { getActiveCredential } from '@/lib/service-auth/credentials'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:00.000Z')
const audience = 'support-tower-service'
let privateKey: CryptoKey
let publicJwk: Record<string, unknown>

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { extractable: true })
  privateKey = pair.privateKey
  publicJwk = await exportJWK(pair.publicKey) as Record<string, unknown>
})

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps cascade`)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values ('assertion-app', 'assertion-app', 'Assertion app', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', ${now}, ${now})
  `)
  await getDb().execute(sql`
    insert into app_credentials (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, created_at)
      values ('credential-1', 'assertion-app', ${JSON.stringify(publicJwk)}::jsonb, 'thumbprint-1', 'ACTIVE', ${now}, ${now})
  `)
})

afterAll(async () => { await closeDbPool() })

describe('service assertion replay protection', () => {
  it('atomically accepts a signed assertion once and persists its replay key', async () => {
    const assertion = await signedAssertion('replay-1')
    const results = await Promise.allSettled([
      verifyClientAssertion({ db: getDb(), assertion, audience, now }),
      verifyClientAssertion({ db: getDb(), assertion, audience, now }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await getDb().execute<{ count: number }>(sql`
      select count(*)::int as count from service_assertion_replays where credential_id = 'credential-1' and assertion_jti = 'replay-1'
    `)).rows).toEqual([{ count: 1 }])
  })

  it('rejects a credential immediately after revocation and uses safe credential projections', async () => {
    await getDb().execute(sql`update app_credentials set status = 'REVOKED', revoked_at = ${now} where id = 'credential-1'`)

    await expect(verifyClientAssertion({ db: getDb(), assertion: await signedAssertion('revoked-1'), audience, now })).rejects.toThrow('Invalid client assertion')
    await expect(getActiveCredential({ db: getDb(), credentialId: 'credential-1', now })).resolves.toBeNull()
  })

  it.each([
    ['PAUSED', 'ACTIVE'],
    ['ACTIVE', 'PAUSED'],
    ['ACTIVE', 'REVOKED'],
  ] as const)('rejects an otherwise active credential when its owner app is %s/%s', async (status, enrollmentStatus) => {
    await getDb().execute(sql`
      update source_apps set status = ${status}::"AppStatus", enrollment_status = ${enrollmentStatus}::"EnrollmentStatus" where id = 'assertion-app'
    `)

    await expect(verifyClientAssertion({ db: getDb(), assertion: await signedAssertion(`owner-${status}-${enrollmentStatus}`), audience, now })).rejects.toThrow('Invalid client assertion')
    await expect(getActiveCredential({ db: getDb(), credentialId: 'credential-1', now })).resolves.toBeNull()
  })
})

async function signedAssertion(jti: string): Promise<string> {
  const seconds = Math.floor(now.getTime() / 1000)
  return new SignJWT({ scope: ['escalations:write'] })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'credential-1' })
    .setIssuer('assertion-app')
    .setSubject('assertion-app')
    .setAudience(audience)
    .setIssuedAt(seconds)
    .setExpirationTime(seconds + 30)
    .setJti(jti)
    .sign(privateKey)
}
