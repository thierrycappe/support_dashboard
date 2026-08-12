import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { test as base, expect, type APIRequestContext } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Pool } from 'pg'

export interface ScenarioContext {
  id: string
  db: Pool
}

export const test = base.extend<{ scenario: ScenarioContext }>({
  scenario: async ({}, provideScenario) => {
    const databaseUrl = process.env.TEST_DATABASE_URL
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
    const db = new Pool({ connectionString: databaseUrl })
    const id = `task22-${randomUUID()}`
    try { await provideScenario({ id, db }) } finally { await db.end() }
  },
})

export { expect }

export interface Connector {
  appId: string
  credentialId: string
  keyId: string
  audience: string
  tokenEndpoint: string
  ingestEndpoint: string
  privateKey: CryptoKey
  publicKey: Record<string, unknown>
}

export async function enrollConnector(request: APIRequestContext, scenario: ScenarioContext, label: string): Promise<Connector> {
  const appId = `${scenario.id}-${label}`
  const slug = appId.toLowerCase()
  const groupId = `${appId}-group`
  const channelId = `${appId}-channel`
  const grantId = `${appId}-grant`
  const secret = randomBytes(32).toString('base64url')
  await scenario.db.query(`insert into support_groups (id,name,status,is_central_fallback,created_at,updated_at) values ($1,$2,'ACTIVE',false,now(),now())`, [groupId, `${appId} owners`])
  await scenario.db.query(`insert into source_apps (id,slug,name,base_url,environment,status,enrollment_status,credential_mode,technical_group_id,created_at,updated_at) values ($1,$2,$3,'https://connector.example.test','test','ACTIVE','PENDING','LEGACY_BEARER',$4,now(),now())`, [appId, slug, `E2E ${label}`, groupId])
  await scenario.db.query(`insert into notification_channels (id,group_id,name,type,status,encrypted_config,config_nonce,config_auth_tag,key_version,redacted_destination,created_at,updated_at) values ($1,$2,'E2E channel','EMAIL','ACTIVE','e2e','e2e','e2e',1,'e2e@example.test',now(),now())`, [channelId, groupId])
  await scenario.db.query(`insert into app_notification_policies (id,source_app_id,minimum_priority,urgent_central_copy,fallback_to_central,created_at,updated_at) values ($1,$2,'LOW',false,true,now(),now())`, [`${appId}-policy`, appId])
  await scenario.db.query(`insert into app_enrollment_grants (id,source_app_id,token_digest,token_prefix,expires_at,created_at) values ($1,$2,$3,$4,now()+interval '30 minutes',now())`, [grantId, appId, createHash('sha256').update(secret).digest('hex'), secret.slice(0, 8)])
  const keys = await generateKeyPair('EdDSA', { extractable: true })
  const publicKey = await exportJWK(keys.publicKey) as Record<string, unknown>
  const response = await request.post('/api/v1/enrollments/exchange', {
    headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.22' },
    data: { grant: { id: grantId, secret }, publicKey, connector: { version: '1.0.0', environment: 'test', baseUrl: 'https://connector.example.test' } },
  })
  expect(response.status()).toBe(201)
  return { ...(await response.json()), privateKey: keys.privateKey, publicKey } as Connector
}

export async function exchangeServiceToken(request: APIRequestContext, connector: Connector, privateKey = connector.privateKey, credentialId = connector.credentialId): Promise<string> {
  const now = Math.floor(Date.now() / 1_000)
  const assertion = await new SignJWT({ scope: 'escalations:write credentials:rotate' })
    .setProtectedHeader({ alg: 'EdDSA', kid: credentialId }).setIssuer(connector.appId).setSubject(connector.appId)
    .setAudience(connector.audience).setIssuedAt(now).setExpirationTime(now + 60).setJti(randomUUID()).sign(privateKey)
  const response = await request.post('/api/v1/service-tokens', { data: { clientAssertion: assertion } })
  expect(response.status()).toBe(200)
  return (await response.json() as { accessToken: string }).accessToken
}

export function escalationPayload(externalId: string, title: string) {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1, externalId, classification: 'BUG', status: 'NEW', priority: 'HIGH', title,
    description: 'Fictional E2E description', sourceUrl: `https://source.example.test/feedback/${externalId}`,
    triage: { ownerRef: 'owner-e2e', ownerName: 'Morgan Lee', escalatedAt: now },
    reporter: { name: null, email: null, sourceId: null }, browserInfo: null, markdownSpec: null, transcript: null,
    remoteCreatedAt: now, remoteUpdatedAt: now, metadata: {},
  }
}
