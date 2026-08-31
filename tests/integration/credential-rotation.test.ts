import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { POST as beginRoute } from '@/app/api/v1/credentials/rotate/route'
import { POST as confirmRoute } from '@/app/api/v1/credentials/rotate/confirm/route'
import { issueServiceAccessToken } from '@/lib/service-auth/access-tokens'
import { cleanupExpiredAssertionReplays } from '@/lib/service-auth/assertions'
import {
  beginAdminCredentialRotation,
  beginCredentialRotation,
  confirmCredentialRotation,
  getActiveCredential,
  revokeCredential,
  RotationError,
} from '@/lib/service-auth/credentials'
import { publicJwkThumbprint } from '@/lib/service-auth/jwk'
import { requireTestDatabaseUrl } from './helpers/database'
import { getApplicationCredentialInventory } from '@/lib/apps/queries'

process.env.DATABASE_URL = requireTestDatabaseUrl()
process.env.SUPPORT_TOWER_PUBLIC_URL = 'https://support.example.test'

const appId = 'rotation-app'
const currentCredentialId = 'rotation-current'
const now = new Date()
let currentKeys: CryptoKeyPair
let nextKeys: CryptoKeyPair
let otherKeys: CryptoKeyPair
let currentJwk: Record<string, unknown>
let nextJwk: Record<string, unknown>
let otherJwk: Record<string, unknown>
let accessToken: string
const MAX_RETAINED_EXPIRED_ROTATIONS = 20

beforeAll(async () => {
  currentKeys = await generateKeyPair('EdDSA', { extractable: true })
  nextKeys = await generateKeyPair('EdDSA', { extractable: true })
  otherKeys = await generateKeyPair('EdDSA', { extractable: true })
  currentJwk = await exportJWK(currentKeys.publicKey) as Record<string, unknown>
  nextJwk = await exportJWK(nextKeys.publicKey) as Record<string, unknown>
  otherJwk = await exportJWK(otherKeys.publicKey) as Record<string, unknown>
  const portal = await generateKeyPair('EdDSA', { extractable: true })
  process.env.SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK = JSON.stringify(await exportJWK(portal.privateKey))
})

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_settings cascade`)
  await getDb().execute(sql`
    insert into support_users (id, email, name, role, status, password_hash, created_at, updated_at)
    values
      ('support-admin', 'rotation-admin@example.test', 'Rotation admin', 'ADMIN', 'ACTIVE', 'test-not-a-real-hash', ${now}, ${now}),
      ('support-user', 'rotation-user@example.test', 'Rotation user', 'SUPPORT', 'ACTIVE', 'test-not-a-real-hash', ${now}, ${now})
    on conflict (id) do update set status = 'ACTIVE', updated_at = excluded.updated_at
  `)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
    values (${appId}, ${appId}, 'Rotation app', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', ${now}, ${now})
  `)
  await seedCredential(currentCredentialId, currentJwk, 'ACTIVE')
  accessToken = await issueServiceAccessToken({
    principal: { appId, credentialId: currentCredentialId, scopes: ['credentials:rotate'] }, now,
  })
})

afterAll(async () => { await closeDbPool() })

describe('overlapping credential rotation', () => {
  it('lets an administrator stage a public key without provider access, then requires the connector new-key proof before overlap', async () => {
    const correlationId = randomUUID()
    const begun = await beginAdminCredentialRotation({
      db: getDb(), appId, parentCredentialId: currentCredentialId, nextPublicJwk: nextJwk,
      actorId: 'support-admin', correlationId, now,
    })

    const staged = await getDb().execute<{
      status: string; publicJwk: unknown; replay: string; actorType: string; actorId: string
    } & Record<string, unknown>>(sql`
      select credential.status, credential.public_jwk as "publicJwk", replay.assertion_jti as replay,
             audit.actor_type as "actorType", audit.actor_id as "actorId"
        from app_credentials credential
        join service_assertion_replays replay on replay.credential_id = credential.id
        join audit_events audit on audit.subject_id = credential.id
       where credential.id = ${begun.credentialId}
         and replay.assertion_jti like 'rotation-challenge:%'
         and audit.action = 'SERVICE_CREDENTIAL_ROTATION_BEGUN'
    `)
    expect(staged.rows[0]).toMatchObject({
      status: 'PENDING', publicJwk: nextJwk,
      replay: `rotation-challenge:${digest(begun.challenge)}`,
      actorType: 'USER', actorId: 'support-admin',
    })
    expect(JSON.stringify(staged.rows[0])).not.toContain(begun.challenge)
    await expect(getActiveCredential({ db: getDb(), credentialId: begun.credentialId, now })).resolves.toBeNull()

    await confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey),
      overlapSeconds: 3_600, correlationId: randomUUID(), now,
    })
    await expect(getActiveCredential({ db: getDb(), credentialId: currentCredentialId, now })).resolves.not.toBeNull()
    await expect(getActiveCredential({ db: getDb(), credentialId: begun.credentialId, now })).resolves.not.toBeNull()

    await revokeCredential({
      db: getDb(), appId, credentialId: currentCredentialId, actorId: 'support-admin',
      actorType: 'USER', correlationId: randomUUID(), now,
    })
    await expect(getActiveCredential({ db: getDb(), credentialId: currentCredentialId, now })).resolves.toBeNull()
    await expect(getActiveCredential({ db: getDb(), credentialId: begun.credentialId, now })).resolves.not.toBeNull()
    const revokedBy = await getDb().execute<{ revokedByUserId: string | null } & Record<string, unknown>>(sql`
      select revoked_by_user_id as "revokedByUserId" from app_credentials where id = ${currentCredentialId}
    `)
    expect(revokedBy.rows[0]?.revokedByUserId).toBe('support-admin')
    await expect(getApplicationCredentialInventory(appId, getDb(), now)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: currentCredentialId, status: 'REVOKED', health: 'REVOKED', canRotateFrom: false, canRevoke: false }),
      expect.objectContaining({ id: begun.credentialId, status: 'ACTIVE', health: 'ACTIVE', canRotateFrom: true, canRevoke: false }),
    ]))
  })

  it('rejects an admin-assisted rotation against a non-active parent or malformed public JWK', async () => {
    await expect(beginAdminCredentialRotation({
      db: getDb(), appId, parentCredentialId: 'missing-parent', nextPublicJwk: nextJwk,
      actorId: 'support-admin', correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' })
    await expect(beginAdminCredentialRotation({
      db: getDb(), appId, parentCredentialId: currentCredentialId,
      nextPublicJwk: { ...nextJwk, d: 'private-key-material' },
      actorId: 'support-admin', correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'INVALID_PROOF' })
    expect(await count(sql`select count(*)::int as count from app_credentials where status = 'PENDING'`)).toBe(0)
  })

  it('persists only a five-minute challenge digest, confirms new-key possession, and caps overlap at seven days', async () => {
    const proof = await rotationProof(nextJwk, 'nonce-lifecycle')
    const begun = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof, correlationId: randomUUID(), now,
    })
    expect(begun.expiresAt).toEqual(new Date(now.getTime() + 5 * 60_000))
    const stored = await getDb().execute<{ status: string; publicJwk: unknown; replay: string; expiresAt: string; validUntil: string }>(sql`
      select credential.status, credential.public_jwk as "publicJwk", replay.assertion_jti as replay,
             replay.expires_at as "expiresAt", credential.valid_until as "validUntil"
        from app_credentials credential
        join service_assertion_replays replay on replay.credential_id = credential.id
       where credential.id = ${begun.credentialId} and replay.assertion_jti like 'rotation-challenge:%'
    `)
    expect(stored.rows[0]).toMatchObject({ status: 'PENDING', publicJwk: nextJwk })
    expect(stored.rows[0]!.replay).toBe(`rotation-challenge:${digest(begun.challenge)}`)
    expect(new Date(stored.rows[0]!.expiresAt)).toEqual(begun.expiresAt)
    expect(new Date(stored.rows[0]!.validUntil)).toEqual(begun.expiresAt)
    expect(JSON.stringify(stored.rows[0])).not.toContain(begun.challenge)
    const confirmed = await confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey),
      overlapSeconds: 8 * 24 * 60 * 60, correlationId: randomUUID(), now,
    })
    const overlapLimit = new Date(now.getTime() + 7 * 24 * 60 * 60_000)
    expect(confirmed.oldCredentialValidUntil).toEqual(overlapLimit)
    await expect(getActiveCredential({ db: getDb(), credentialId: begun.credentialId, now })).resolves.toMatchObject({ sourceAppId: appId })
    const activated = await getDb().execute<{ validUntil: string | null } & Record<string, unknown>>(sql`
      select valid_until as "validUntil" from app_credentials where id = ${begun.credentialId}
    `)
    expect(activated.rows[0]?.validUntil).toBeNull()
    const rotationActors = await getDb().execute<{ actorType: string } & Record<string, unknown>>(sql`
      select actor_type as "actorType" from audit_events
       where subject_id = ${begun.credentialId}
         and action in ('SERVICE_CREDENTIAL_ROTATION_BEGUN', 'SERVICE_CREDENTIAL_ROTATION_CONFIRMED')
       order by action
    `)
    expect(rotationActors.rows).toEqual([{ actorType: 'APPLICATION' }, { actorType: 'APPLICATION' }])
    await expect(getActiveCredential({ db: getDb(), credentialId: currentCredentialId, now: new Date(overlapLimit.getTime() - 1) })).resolves.not.toBeNull()
    await expect(getActiveCredential({ db: getDb(), credentialId: currentCredentialId, now: overlapLimit })).resolves.toBeNull()
  })

  it('uses both possession proofs through the public routes', async () => {
    const begin = await beginRoute(jsonRequest('/api/v1/credentials/rotate', {
      nextPublicKey: nextJwk, proof: await rotationProof(nextJwk, 'nonce-route'),
    }))
    expect(begin.status).toBe(201)
    const challenge = await begin.json() as { credentialId: string; challenge: string }
    const confirm = await confirmRoute(jsonRequest('/api/v1/credentials/rotate/confirm', {
      credentialId: challenge.credentialId, challenge: challenge.challenge,
      signature: await challengeSignature(challenge.credentialId, challenge.challenge, nextKeys.privateKey), overlapSeconds: 3_600,
    }))
    expect(confirm.status).toBe(200)
    expect(confirm.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['wrong signing key', () => rotationProof(nextJwk, 'wrong-key', { key: otherKeys.privateKey })],
    ['wrong app', () => rotationProof(nextJwk, 'wrong-app', { appId: 'other-app' })],
    ['wrong current credential', () => rotationProof(nextJwk, 'wrong-current', { currentCredentialId: 'other-credential' })],
    ['changed next JWK', () => rotationProof(otherJwk, 'changed-body')],
    ['expired proof', () => rotationProof(nextJwk, 'expired', { issuedAt: new Date(now.getTime() - 70_000) })],
  ])('rejects %s without creating pending state', async (_name, buildProof) => {
    await expect(beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await buildProof(), correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'INVALID_PROOF' })
    expect(await count(sql`select count(*)::int as count from app_credentials where status = 'PENDING'`)).toBe(0)
  })

  it('rejects replayed nonce, duplicate key, and concurrent rotations atomically', async () => {
    const nonce = 'nonce-replay'
    await beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await rotationProof(nextJwk, nonce), correlationId: randomUUID(), now })
    await expect(beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: otherJwk, proof: await rotationProof(otherJwk, nonce), correlationId: randomUUID(), now }))
      .rejects.toBeInstanceOf(RotationError)
    await expect(beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await rotationProof(nextJwk, 'duplicate'), correlationId: randomUUID(), now }))
      .rejects.toMatchObject({ code: 'DUPLICATE_CREDENTIAL' })

    await resetPending()
    const first = beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await rotationProof(nextJwk, 'concurrent-a'), correlationId: randomUUID(), now })
    const second = beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: otherJwk, proof: await rotationProof(otherJwk, 'concurrent-b'), correlationId: randomUUID(), now })
    const settled = await Promise.allSettled([first, second])
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await count(sql`select count(*)::int as count from app_credentials where status = 'PENDING'`)).toBe(1)
  })

  it('expires stale pending rotations and bounds retained history per app', async () => {
    let attemptNow = now
    const lifecycleCorrelation = randomUUID()
    for (let attempt = 0; attempt < MAX_RETAINED_EXPIRED_ROTATIONS + 5; attempt += 1) {
      const keys = await generateKeyPair('EdDSA', { extractable: true })
      const publicJwk = await exportJWK(keys.publicKey) as Record<string, unknown>
      await beginCredentialRotation({
        db: getDb(), principal: principal(), nextPublicJwk: publicJwk,
        proof: await rotationProof(publicJwk, `expiry-${attempt}`, { issuedAt: attemptNow }),
        correlationId: lifecycleCorrelation, now: attemptNow,
      })
      attemptNow = new Date(attemptNow.getTime() + 5 * 60_000 + 6_000)
      if (attempt < MAX_RETAINED_EXPIRED_ROTATIONS + 4) {
        await cleanupExpiredAssertionReplays({ db: getDb(), now: attemptNow, limit: 500 })
      }
    }
    expect(await count(sql`
      select count(*)::int as count from app_credentials
       where source_app_id = ${appId} and status = 'PENDING'
    `)).toBe(1)
    expect(await count(sql`
      select count(*)::int as count from app_credentials
       where source_app_id = ${appId} and status = 'EXPIRED'
    `)).toBe(MAX_RETAINED_EXPIRED_ROTATIONS)
    expect(await count(sql`
      select count(*)::int as count from app_credentials
       where source_app_id = ${appId} and status in ('PENDING', 'EXPIRED')
    `)).toBe(MAX_RETAINED_EXPIRED_ROTATIONS + 1)
    const lifecycleAudits = await getDb().execute<{ action: string; subjectId: string; actorType: string } & Record<string, unknown>>(sql`
      select action, subject_id as "subjectId", actor_type as "actorType" from audit_events
       where request_correlation_id = ${lifecycleCorrelation}
         and action in ('SERVICE_CREDENTIAL_ROTATION_EXPIRED', 'SERVICE_CREDENTIAL_ROTATION_PRUNED')
       order by created_at, id
    `)
    expect(lifecycleAudits.rows.filter(({ action }) => action === 'SERVICE_CREDENTIAL_ROTATION_EXPIRED')).toHaveLength(24)
    expect(lifecycleAudits.rows.filter(({ action }) => action === 'SERVICE_CREDENTIAL_ROTATION_PRUNED')).toHaveLength(4)
    expect(new Set(lifecycleAudits.rows.map(({ subjectId }) => subjectId)).size).toBe(24)
    expect(new Set(lifecycleAudits.rows.map(({ actorType }) => actorType))).toEqual(new Set(['APPLICATION']))
  })

  it('expires a pending rotation and permits its replacement at the exact validUntil boundary', async () => {
    const begun = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk,
      proof: await rotationProof(nextJwk, 'exact-begin-first'), correlationId: randomUUID(), now,
    })
    const replacement = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: otherJwk,
      proof: await rotationProof(otherJwk, 'exact-begin-second', { issuedAt: begun.expiresAt }),
      correlationId: randomUUID(), now: begun.expiresAt,
    })
    expect(replacement.credentialId).not.toBe(begun.credentialId)
    const statuses = await getDb().execute<{ id: string; status: string } & Record<string, unknown>>(sql`
      select id, status from app_credentials where id in (${begun.credentialId}, ${replacement.credentialId}) order by id
    `)
    expect(new Map(statuses.rows.map(({ id, status }) => [id, status]))).toEqual(new Map([
      [begun.credentialId, 'EXPIRED'], [replacement.credentialId, 'PENDING'],
    ]))
  })

  it('rolls back durable expiration and its lifecycle audit when the transaction fails', async () => {
    const correlationId = randomUUID()
    const begun = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk,
      proof: await rotationProof(nextJwk, 'expiry-rollback-first'), correlationId, now,
    })
    const later = new Date(now.getTime() + 5 * 60_000 + 6_000)
    await cleanupExpiredAssertionReplays({ db: getDb(), now: later, limit: 500 })
    await expect(beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: otherJwk,
      proof: await rotationProof(otherJwk, 'expiry-rollback-second', { issuedAt: later }), correlationId, now: later,
      afterExpiredRotationsAudited: async () => { throw new Error('injected lifecycle audit failure') },
    })).rejects.toThrow('injected lifecycle audit failure')
    const credential = await getDb().execute<{ status: string } & Record<string, unknown>>(sql`
      select status from app_credentials where id = ${begun.credentialId}
    `)
    expect(credential.rows[0]?.status).toBe('PENDING')
    expect(await count(sql`
      select count(*)::int as count from audit_events
       where request_correlation_id = ${correlationId} and action = 'SERVICE_CREDENTIAL_ROTATION_EXPIRED'
    `)).toBe(0)
  })

  it('enforces one durable live pending rotation even if its replay marker is missing', async () => {
    const begun = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk,
      proof: await rotationProof(nextJwk, 'durable-live-first'), correlationId: randomUUID(), now,
    })
    await getDb().execute(sql`delete from service_assertion_replays where credential_id = ${begun.credentialId}`)
    await expect(beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: otherJwk,
      proof: await rotationProof(otherJwk, 'durable-live-second'), correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'ROTATION_IN_PROGRESS' })
    expect(await count(sql`select count(*)::int as count from app_credentials where status = 'PENDING'`)).toBe(1)
  })

  it('rolls back both prune audit and deletion when a post-delete step fails', async () => {
    const correlationId = randomUUID()
    for (let position = 0; position < MAX_RETAINED_EXPIRED_ROTATIONS + 1; position += 1) {
      await getDb().execute(sql`
        insert into app_credentials
          (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, valid_until, rotation_parent_id, created_at)
        values
          (${`expired-prune-${position}`}, ${appId}, ${JSON.stringify(nextJwk)}::jsonb, ${`expired-thumb-${position}`},
           'EXPIRED', ${now}, ${now}, ${currentCredentialId}, ${new Date(now.getTime() + position)})
      `)
    }
    await expect(beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: otherJwk,
      proof: await rotationProof(otherJwk, 'prune-rollback'), correlationId, now,
      afterPrunedRotationDeleted: async () => { throw new Error('injected post-prune failure') },
    })).rejects.toThrow('injected post-prune failure')
    expect(await count(sql`select count(*)::int as count from app_credentials where id like 'expired-prune-%'`))
      .toBe(MAX_RETAINED_EXPIRED_ROTATIONS + 1)
    expect(await count(sql`
      select count(*)::int as count from audit_events
       where request_correlation_id = ${correlationId} and action = 'SERVICE_CREDENTIAL_ROTATION_PRUNED'
    `)).toBe(0)
  })

  it('maps only the thumbprint unique race to a deterministic duplicate conflict with no partial writes', async () => {
    const secondAppId = 'rotation-app-second'
    const secondCredentialId = 'rotation-current-second'
    const secondCurrent = await generateKeyPair('EdDSA', { extractable: true })
    const secondCurrentJwk = await exportJWK(secondCurrent.publicKey) as Record<string, unknown>
    const firstCorrelation = randomUUID()
    const secondCorrelation = randomUUID()
    await getDb().execute(sql`
      insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values (${secondAppId}, ${secondAppId}, 'Second rotation app', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', ${now}, ${now})
    `)
    await getDb().execute(sql`
      insert into app_credentials (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, created_at)
      values (${secondCredentialId}, ${secondAppId}, ${JSON.stringify(secondCurrentJwk)}::jsonb,
              ${publicJwkThumbprint(secondCurrentJwk)}, 'ACTIVE', ${now}, ${now})
    `)

    let duplicateChecks = 0
    const bothChecked = deferred<void>()
    const release = deferred<void>()
    const afterDuplicateChecked = async () => {
      duplicateChecks += 1
      if (duplicateChecks === 2) bothChecked.resolve()
      await release.promise
    }
    const first = beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk,
      proof: await rotationProof(nextJwk, 'cross-app-first'), correlationId: firstCorrelation, now,
      afterDuplicateChecked,
    })
    const secondProof = await new SignJWT({
      appId: secondAppId, currentCredentialId: secondCredentialId,
      nextJwkThumbprint: publicJwkThumbprint(nextJwk), nonce: 'cross-app-second',
    }).setProtectedHeader({ alg: 'EdDSA', kid: secondCredentialId })
      .setAudience('/api/v1/credentials/rotate').setIssuedAt(Math.floor(now.getTime() / 1_000))
      .setExpirationTime(Math.floor(now.getTime() / 1_000) + 60).sign(secondCurrent.privateKey)
    const second = beginCredentialRotation({
      db: getDb(), principal: { appId: secondAppId, credentialId: secondCredentialId, scopes: ['credentials:rotate'] },
      nextPublicJwk: nextJwk, proof: secondProof, correlationId: secondCorrelation, now,
      afterDuplicateChecked,
    })
    const settlement = Promise.allSettled([first, second])
    await bothChecked.promise
    release.resolve()
    const settled = await settlement
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected?.reason).toMatchObject({ code: 'DUPLICATE_CREDENTIAL' })
    expect(await count(sql`select count(*)::int as count from app_credentials where status = 'PENDING'`)).toBe(1)
    expect(await count(sql`select count(*)::int as count from service_assertion_replays where assertion_jti like 'rotation-proof:%'`)).toBe(1)
    expect(await count(sql`select count(*)::int as count from audit_events where request_correlation_id in (${firstCorrelation}, ${secondCorrelation})`)).toBe(1)

    const otherUnique = Object.assign(new Error('unrelated unique constraint'), { code: '23505', constraint: 'audit_events_pkey' })
    await resetPending()
    await expect(beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: otherJwk,
      proof: await rotationProof(otherJwk, 'unrelated-unique'), correlationId: randomUUID(), now,
      afterPendingCreated: async () => { throw otherUnique },
    })).rejects.toBe(otherUnique)
  })

  it('rejects wrong, expired, and reused challenge proofs', async () => {
    const begun = await beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await rotationProof(nextJwk, 'confirm-errors'), correlationId: randomUUID(), now })
    await expect(confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, otherKeys.privateKey), overlapSeconds: 1, correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' })
    await expect(confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey), overlapSeconds: 1, correlationId: randomUUID(), now: begun.expiresAt,
    })).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' })
    await confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey), overlapSeconds: 1, correlationId: randomUUID(), now,
    })
    await expect(confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey), overlapSeconds: 1, correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' })
  })

  it.each(['pending', 'audit'] as const)('rolls back begin after injected %s failure', async (stage) => {
    await expect(beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await rotationProof(nextJwk, `rollback-${stage}`), correlationId: randomUUID(), now,
      afterPendingCreated: stage === 'pending' ? async () => { throw new Error('injected') } : undefined,
      afterAuditAppended: stage === 'audit' ? async () => { throw new Error('injected') } : undefined,
    })).rejects.toThrow('injected')
    expect(await count(sql`select count(*)::int as count from app_credentials where status = 'PENDING'`)).toBe(0)
    expect(await count(sql`select count(*)::int as count from service_assertion_replays where assertion_jti like 'rotation-%'`)).toBe(0)
  })

  it('rolls back confirmation when a later write fails', async () => {
    const begun = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk,
      proof: await rotationProof(nextJwk, 'confirm-rollback'), correlationId: randomUUID(), now,
    })
    await expect(confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey),
      overlapSeconds: 60, correlationId: randomUUID(), now,
      afterActivated: async () => { throw new Error('injected confirmation failure') },
    })).rejects.toThrow('injected confirmation failure')
    await expect(getActiveCredential({ db: getDb(), credentialId: begun.credentialId, now })).resolves.toBeNull()
    await expect(getActiveCredential({ db: getDb(), credentialId: currentCredentialId, now })).resolves.not.toBeNull()
    expect(await count(sql`
      select count(*)::int as count from service_assertion_replays
       where credential_id = ${begun.credentialId} and assertion_jti = ${`rotation-challenge:${digest(begun.challenge)}`}
    `)).toBe(1)
  })

  it('revokes immediately, refuses the last active key, and serializes concurrent revocations', async () => {
    await seedCredential('rotation-second', otherJwk, 'ACTIVE')
    const settled = await Promise.allSettled([
      revokeCredential({ db: getDb(), appId, credentialId: currentCredentialId, actorId: appId, actorType: 'APPLICATION', correlationId: randomUUID(), now }),
      revokeCredential({ db: getDb(), appId, credentialId: 'rotation-second', actorId: appId, actorType: 'APPLICATION', correlationId: randomUUID(), now }),
    ])
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await count(sql`select count(*)::int as count from app_credentials where source_app_id = ${appId} and status = 'ACTIVE'`)).toBe(1)
    const last = await activeCredentialId()
    await expect(revokeCredential({ db: getDb(), appId, credentialId: last, actorId: appId, actorType: 'APPLICATION', correlationId: randomUUID(), now }))
      .rejects.toMatchObject({ code: 'LAST_ACTIVE_CREDENTIAL' })

    await getDb().execute(sql`update source_apps set status = 'PAUSED' where id = ${appId}`)
    await expect(revokeCredential({ db: getDb(), appId, credentialId: last, actorId: appId, actorType: 'APPLICATION', correlationId: randomUUID(), now })).resolves.toBe(true)
    await expect(getActiveCredential({ db: getDb(), credentialId: last, now })).resolves.toBeNull()
  })

  it('records support-initiated revocation as USER and app-initiated revocation as APPLICATION', async () => {
    await seedCredential('rotation-second', otherJwk, 'ACTIVE')
    const userCorrelation = randomUUID()
    const appCorrelation = randomUUID()
    await revokeCredential({
      db: getDb(), appId, credentialId: 'rotation-second', actorId: 'support-user',
      actorType: 'USER', correlationId: userCorrelation, now,
    })
    await getDb().execute(sql`update source_apps set status = 'PAUSED' where id = ${appId}`)
    await revokeCredential({
      db: getDb(), appId, credentialId: currentCredentialId, actorId: appId,
      actorType: 'APPLICATION', correlationId: appCorrelation, now,
    })
    const actors = await getDb().execute<{ correlationId: string; actorType: string; actorId: string } & Record<string, unknown>>(sql`
      select request_correlation_id as "correlationId", actor_type as "actorType", actor_id as "actorId"
        from audit_events where request_correlation_id in (${userCorrelation}, ${appCorrelation})
    `)
    expect(actors.rows).toEqual(expect.arrayContaining([
      { correlationId: userCorrelation, actorType: 'USER', actorId: 'support-user' },
      { correlationId: appCorrelation, actorType: 'APPLICATION', actorId: appId },
    ]))
  })

  it.each([
    ['active app and active enrollment', 'ACTIVE', 'ACTIVE', false],
    ['active app and pending enrollment', 'ACTIVE', 'PENDING', false],
    ['paused app', 'PAUSED', 'ACTIVE', true],
    ['paused enrollment', 'ACTIVE', 'PAUSED', true],
    ['revoked enrollment', 'ACTIVE', 'REVOKED', true],
  ] as const)('applies the last-key rule for %s', async (_name, appStatus, enrollmentStatus, permitted) => {
    await getDb().execute(sql`
      update source_apps set status = ${appStatus}, enrollment_status = ${enrollmentStatus} where id = ${appId}
    `)
    const operation = revokeCredential({
      db: getDb(), appId, credentialId: currentCredentialId, actorId: appId, actorType: 'APPLICATION', correlationId: randomUUID(), now,
    })
    if (permitted) await expect(operation).resolves.toBe(true)
    else await expect(operation).rejects.toMatchObject({ code: 'LAST_ACTIVE_CREDENTIAL' })
  })
})

function principal() { return { appId, credentialId: currentCredentialId, scopes: ['credentials:rotate' as const] } }

async function seedCredential(id: string, publicJwk: Record<string, unknown>, status: 'ACTIVE' | 'PENDING'): Promise<void> {
  await getDb().execute(sql`
    insert into app_credentials (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, created_at)
    values (${id}, ${appId}, ${JSON.stringify(publicJwk)}::jsonb, ${publicJwkThumbprint(publicJwk)}, ${status}, ${now}, ${now})
  `)
}

async function rotationProof(nextPublicKey: Record<string, unknown>, nonce: string, overrides: {
  key?: CryptoKey; appId?: string; currentCredentialId?: string; issuedAt?: Date
} = {}): Promise<string> {
  const issuedAt = Math.floor((overrides.issuedAt ?? now).getTime() / 1_000)
  return new SignJWT({
    appId: overrides.appId ?? appId,
    currentCredentialId: overrides.currentCredentialId ?? currentCredentialId,
    nextJwkThumbprint: publicJwkThumbprint(nextPublicKey), nonce,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: currentCredentialId })
    .setAudience('/api/v1/credentials/rotate').setIssuedAt(issuedAt).setExpirationTime(issuedAt + 60)
    .sign(overrides.key ?? currentKeys.privateKey)
}

async function challengeSignature(credentialId: string, challenge: string, key: CryptoKey): Promise<string> {
  const message = new TextEncoder().encode(`support-tower-rotation:${credentialId}:${challenge}`)
  return Buffer.from(await crypto.subtle.sign('Ed25519', key, message)).toString('base64url')
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://support.example.test${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', 'x-correlation-id': randomUUID() }, body: JSON.stringify(body),
  })
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

async function count(query: ReturnType<typeof sql>): Promise<number> {
  return (await getDb().execute<{ count: number }>(query)).rows[0]?.count ?? 0
}

async function resetPending(): Promise<void> {
  await getDb().execute(sql`delete from app_credentials where status = 'PENDING'`)
}

async function activeCredentialId(): Promise<string> {
  const result = await getDb().execute<{ id: string }>(sql`select id from app_credentials where source_app_id = ${appId} and status = 'ACTIVE' limit 1`)
  return result.rows[0]!.id
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
