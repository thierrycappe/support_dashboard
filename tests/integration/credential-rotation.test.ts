import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { POST as beginRoute } from '@/app/api/v1/credentials/rotate/route'
import { POST as confirmRoute } from '@/app/api/v1/credentials/rotate/confirm/route'
import { issueServiceAccessToken } from '@/lib/service-auth/access-tokens'
import {
  beginCredentialRotation,
  confirmCredentialRotation,
  getActiveCredential,
  revokeCredential,
  RotationError,
} from '@/lib/service-auth/credentials'
import { publicJwkThumbprint } from '@/lib/service-auth/jwk'
import { requireTestDatabaseUrl } from './helpers/database'

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
  it('persists only a five-minute challenge digest, confirms new-key possession, and caps overlap at seven days', async () => {
    const proof = await rotationProof(nextJwk, 'nonce-lifecycle')
    const begun = await beginCredentialRotation({
      db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof, correlationId: randomUUID(), now,
    })
    expect(begun.expiresAt).toEqual(new Date(now.getTime() + 5 * 60_000))
    const stored = await getDb().execute<{ status: string; publicJwk: unknown; replay: string; expiresAt: string }>(sql`
      select credential.status, credential.public_jwk as "publicJwk", replay.assertion_jti as replay,
             replay.expires_at as "expiresAt"
        from app_credentials credential
        join service_assertion_replays replay on replay.credential_id = credential.id
       where credential.id = ${begun.credentialId} and replay.assertion_jti like 'rotation-challenge:%'
    `)
    expect(stored.rows[0]).toMatchObject({ status: 'PENDING', publicJwk: nextJwk })
    expect(stored.rows[0]!.replay).toBe(`rotation-challenge:${digest(begun.challenge)}`)
    expect(new Date(stored.rows[0]!.expiresAt)).toEqual(begun.expiresAt)
    expect(JSON.stringify(stored.rows[0])).not.toContain(begun.challenge)

    const confirmed = await confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey),
      overlapSeconds: 8 * 24 * 60 * 60, correlationId: randomUUID(), now,
    })
    const overlapLimit = new Date(now.getTime() + 7 * 24 * 60 * 60_000)
    expect(confirmed.oldCredentialValidUntil).toEqual(overlapLimit)
    await expect(getActiveCredential({ db: getDb(), credentialId: begun.credentialId, now })).resolves.toMatchObject({ sourceAppId: appId })
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

  it('rejects wrong, expired, and reused challenge proofs', async () => {
    const begun = await beginCredentialRotation({ db: getDb(), principal: principal(), nextPublicJwk: nextJwk, proof: await rotationProof(nextJwk, 'confirm-errors'), correlationId: randomUUID(), now })
    await expect(confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, otherKeys.privateKey), overlapSeconds: 1, correlationId: randomUUID(), now,
    })).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' })
    await expect(confirmCredentialRotation({
      db: getDb(), principal: principal(), credentialId: begun.credentialId, challenge: begun.challenge,
      signature: await challengeSignature(begun.credentialId, begun.challenge, nextKeys.privateKey), overlapSeconds: 1, correlationId: randomUUID(), now: new Date(now.getTime() + 5 * 60_000 + 1),
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
      revokeCredential({ db: getDb(), appId, credentialId: currentCredentialId, actorId: appId, correlationId: randomUUID(), now }),
      revokeCredential({ db: getDb(), appId, credentialId: 'rotation-second', actorId: appId, correlationId: randomUUID(), now }),
    ])
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await count(sql`select count(*)::int as count from app_credentials where source_app_id = ${appId} and status = 'ACTIVE'`)).toBe(1)
    const last = await activeCredentialId()
    await expect(revokeCredential({ db: getDb(), appId, credentialId: last, actorId: appId, correlationId: randomUUID(), now }))
      .rejects.toMatchObject({ code: 'LAST_ACTIVE_CREDENTIAL' })

    await getDb().execute(sql`update source_apps set status = 'PAUSED' where id = ${appId}`)
    await expect(revokeCredential({ db: getDb(), appId, credentialId: last, actorId: appId, correlationId: randomUUID(), now })).resolves.toBe(true)
    await expect(getActiveCredential({ db: getDb(), credentialId: last, now })).resolves.toBeNull()
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
