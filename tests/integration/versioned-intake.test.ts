import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { POST as exchangeRoute } from '@/app/api/v1/enrollments/exchange/route'
import { POST as tokenRoute } from '@/app/api/v1/service-tokens/route'
import { POST as escalationRoute } from '@/app/api/v1/escalations/route'
import { createInvitation } from '@/lib/service-auth/invitations'
import { exchangeEnrollment, invitationRateSubject } from '@/lib/service-auth/guards'
import { issueServiceAccessToken } from '@/lib/service-auth/access-tokens'
import { consumeServiceRateLimit, serviceRateLimits } from '@/lib/service-auth/rate-limit'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
process.env.SUPPORT_TOWER_PUBLIC_URL = 'https://support.example.test'

let appPrivateKey: CryptoKey
let appPublicJwk: Record<string, unknown>
let appId: string
let invitation: Awaited<ReturnType<typeof createInvitation>>

beforeAll(async () => {
  const appKeys = await generateKeyPair('EdDSA', { extractable: true })
  appPrivateKey = appKeys.privateKey
  appPublicJwk = await exportJWK(appKeys.publicKey) as Record<string, unknown>
  const portalKeys = await generateKeyPair('EdDSA', { extractable: true })
  process.env.SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK = JSON.stringify(await exportJWK(portalKeys.privateKey))
})

beforeEach(async () => {
  appId = `v1-app-${randomUUID()}`
  await getDb().execute(sql`truncate table source_apps, support_groups, support_settings cascade`)
  await getDb().execute(sql`delete from service_rate_limit_buckets`)
  await getDb().execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
    values (${appId}, ${appId}, 'Versioned app', 'test', 'ACTIVE', 'PENDING', 'LEGACY_BEARER', now(), now())
  `)
  invitation = await createInvitation({ db: getDb(), sourceAppId: appId })
})

afterAll(async () => { await closeDbPool() })

describe('versioned connector routes', () => {
  it('atomically allows one concurrent invitation exchange and rejects reuse', async () => {
    const results = await Promise.all([
      exchangeRoute(enrollmentRequest(invitation.secret)),
      exchangeRoute(enrollmentRequest(invitation.secret)),
    ])
    expect(results.map((response) => response.status).sort()).toEqual([201, 401])
    expect(await scalar(sql`select count(*)::int as count from app_credentials where source_app_id = ${appId}`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from app_enrollment_grants where id = ${invitation.id} and consumed_at is not null`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from source_apps where id = ${appId} and enrollment_status = 'ACTIVE' and credential_mode = 'PUBLIC_KEY'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'SERVICE_APP_ENROLLED' and subject_id = ${appId}`)).toBe(1)

    expect((await exchangeRoute(enrollmentRequest(invitation.secret))).status).toBe(401)
  })

  it.each(['credential', 'audit'] as const)('rolls back every exchange mutation after injected %s-stage failure and leaves the grant usable', async (stage) => {
    await expect(exchangeEnrollment({
      db: getDb(), invitation: invitation.secret, publicJwk: appPublicJwk, clientIp: '203.0.113.8', correlationId: randomUUID(),
      afterCredentialCreated: stage === 'credential' ? async () => { throw new Error('injected') } : undefined,
      afterAuditAppended: stage === 'audit' ? async () => { throw new Error('injected') } : undefined,
    })).rejects.toThrow('injected')

    expect(await scalar(sql`select count(*)::int as count from app_credentials where source_app_id = ${appId}`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from app_enrollment_grants where id = ${invitation.id} and consumed_at is not null`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from source_apps where id = ${appId} and enrollment_status = 'PENDING' and credential_mode = 'LEGACY_BEARER'`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from audit_events where action = 'SERVICE_APP_ENROLLED' and subject_id = ${appId}`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from service_rate_limit_buckets where subject in (${invitationRateSubject(invitation.secret)}, '203.0.113.8')`)).toBe(0)
    await expect(exchangeEnrollment({ db: getDb(), invitation: invitation.secret, publicJwk: appPublicJwk, clientIp: '203.0.113.8', correlationId: randomUUID() })).resolves.toMatchObject({ kind: 'created', appId })
  })

  it('issues one five-minute token and rejects replay of the client assertion', async () => {
    const credentialId = await enroll()
    const assertion = await clientAssertion(credentialId, `assertion-${randomUUID()}`)
    const first = await tokenRoute(jsonRequest('/api/v1/service-tokens', { clientAssertion: assertion }))
    expect(first.status).toBe(200)
    const body = await first.json() as { accessToken: string; expiresIn: number }
    expect(body.accessToken.split('.')).toHaveLength(3)
    expect(body.expiresIn).toBe(300)
    expect((await tokenRoute(jsonRequest('/api/v1/service-tokens', { clientAssertion: assertion }))).status).toBe(401)
  })

  it.each(['invitation', 'ip'] as const)('enforces the enrollment %s rate-limit dimension', async (dimension) => {
    const now = new Date()
    const limit = dimension === 'invitation' ? serviceRateLimits.enrollmentInvitation : serviceRateLimits.enrollmentIp
    const scope = dimension === 'invitation' ? 'enrollment:invitation' : 'enrollment:ip'
    const subject = dimension === 'invitation' ? invitationRateSubject(invitation.secret) : '203.0.113.8'
    for (let index = 0; index < limit.limit; index += 1) {
      await consumeServiceRateLimit({ tx: getDb(), scope, subject, ...limit, now })
    }

    const response = await exchangeRoute(enrollmentRequest(invitation.secret))

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await scalar(sql`select count(*)::int as count from app_credentials where source_app_id = ${appId}`)).toBe(0)
  })

  it.each(['burst', 'sustained'] as const)('enforces the token credential %s rate-limit dimension', async (dimension) => {
    const credentialId = await enroll()
    const now = new Date()
    const limit = dimension === 'burst' ? serviceRateLimits.tokenCredential.burst : serviceRateLimits.tokenCredential.limit
    const windowMs = dimension === 'burst' ? 1_000 : serviceRateLimits.tokenCredential.windowMs
    const scope = `token:credential:${dimension}`
    for (let index = 0; index < limit; index += 1) {
      await consumeServiceRateLimit({ tx: getDb(), scope, subject: credentialId, limit, windowMs, now })
    }
    const assertion = await clientAssertion(credentialId, `limited-${dimension}-${randomUUID()}`)

    const response = await tokenRoute(jsonRequest('/api/v1/service-tokens', { clientAssertion: assertion }))

    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await scalar(sql`select count(*)::int as count from service_assertion_replays where credential_id = ${credentialId}`)).toBe(0)
  })

  it('accepts, deduplicates, and conflicts using token identity and idempotency', async () => {
    const credentialId = await enroll()
    const accessToken = await issueServiceAccessToken({ principal: { appId, credentialId, scopes: ['escalations:write'] } })
    const headers = { authorization: `Bearer ${accessToken}`, 'idempotency-key': 'versioned-once' }
    const created = await escalationRoute(jsonRequest('/api/v1/escalations', escalationBody(), headers))
    const duplicate = await escalationRoute(jsonRequest('/api/v1/escalations', escalationBody(), headers))
    const conflict = await escalationRoute(jsonRequest('/api/v1/escalations', { ...escalationBody(), title: 'Changed' }, headers))

    expect(created.status).toBe(201)
    expect(duplicate.status).toBe(200)
    expect(conflict.status).toBe(409)
    expect(await scalar(sql`select count(*)::int as count from feedback_tickets where source_app_id = ${appId}`)).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from delivery_outbox where escalation_event_id in (select id from escalation_events where ticket_id in (select id from feedback_tickets where source_app_id = ${appId}))`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as count from routing_incidents where escalation_event_id in (select id from escalation_events where ticket_id in (select id from feedback_tickets where source_app_id = ${appId}))`)).toBe(1)
  })

  it('rejects a revoked access token and enforces the token-derived app rate limit', async () => {
    const credentialId = await enroll()
    const accessToken = await issueServiceAccessToken({ principal: { appId, credentialId, scopes: ['escalations:write'] } })
    await getDb().execute(sql`update app_credentials set status = 'REVOKED', revoked_at = now() where id = ${credentialId}`)
    expect((await escalationRoute(jsonRequest('/api/v1/escalations', escalationBody(), {
      authorization: `Bearer ${accessToken}`, 'idempotency-key': 'revoked',
    }))).status).toBe(401)

    await getDb().execute(sql`update app_credentials set status = 'ACTIVE', revoked_at = null where id = ${credentialId}`)
    const rateNow = new Date()
    for (let index = 0; index < serviceRateLimits.ingestApp.limit; index += 1) {
      await consumeServiceRateLimit({ tx: getDb(), scope: 'intake:app', subject: appId, ...serviceRateLimits.ingestApp, now: rateNow })
    }
    const limited = await escalationRoute(jsonRequest('/api/v1/escalations', escalationBody(), {
      authorization: `Bearer ${accessToken}`, 'idempotency-key': 'limited',
    }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

async function enroll(): Promise<string> {
  const response = await exchangeRoute(enrollmentRequest(invitation.secret))
  expect(response.status).toBe(201)
  return ((await response.json()) as { credentialId: string }).credentialId
}

async function clientAssertion(credentialId: string, jti: string): Promise<string> {
  const seconds = Math.floor(Date.now() / 1000)
  return new SignJWT({ scope: ['escalations:write'] })
    .setProtectedHeader({ alg: 'EdDSA', kid: credentialId }).setIssuer(appId).setSubject(appId)
    .setAudience('support-tower-service').setIssuedAt(seconds).setExpirationTime(seconds + 30).setJti(jti).sign(appPrivateKey)
}

function enrollmentRequest(secret: string): Request {
  return jsonRequest('/api/v1/enrollments/exchange', { invitation: secret, publicJwk: appPublicJwk }, { 'x-vercel-forwarded-for': '203.0.113.8' })
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://tower${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': randomUUID(), ...headers }, body: JSON.stringify(body) })
}

function escalationBody() {
  return {
    schemaVersion: 1, externalId: 'external-1', classification: 'BUG', status: 'NEW', priority: 'HIGH', title: 'A bug', description: 'Details', sourceUrl: null,
    triage: { ownerRef: 'owner', ownerName: null, escalatedAt: '2026-08-12T12:00:00.000Z' }, reporter: { name: null, email: null, sourceId: null },
    browserInfo: null, markdownSpec: null, transcript: null, remoteCreatedAt: null, remoteUpdatedAt: null, metadata: {},
  }
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  return (await getDb().execute<{ count: number }>(query)).rows[0]?.count ?? 0
}
