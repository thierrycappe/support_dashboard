// scaffold:scenario:SCN-008:81c6954c
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import * as schema from '@/lib/db/schema'
import { revokeCredential } from '@/lib/service-auth/credentials'
import { publicJwkThumbprint } from '@/lib/service-auth/jwk'
import { enrollConnector, exchangeServiceToken, expect, test } from '../../helpers/fixtures'

test('SCN-008 — a next key activates, overlaps, and supersedes a revoked old key', async ({ request, scenario }) => {
  const connector = await enrollConnector(request, scenario, 'rotation')
  const currentToken = await exchangeServiceToken(request, connector)
  const nextKeys = await generateKeyPair('EdDSA', { extractable: true })
  const nextPublicKey = await exportJWK(nextKeys.publicKey) as Record<string, unknown>
  const issuedAt = Math.floor(Date.now() / 1_000)
  const proof = await new SignJWT({
    appId: connector.appId, currentCredentialId: connector.credentialId,
    nextJwkThumbprint: publicJwkThumbprint(nextPublicKey), nonce: randomUUID(),
  }).setProtectedHeader({ alg: 'EdDSA', kid: connector.credentialId })
    .setAudience('/api/v1/credentials/rotate').setIssuedAt(issuedAt).setExpirationTime(issuedAt + 60).sign(connector.privateKey)
  const begun = await request.post('/api/v1/credentials/rotate', {
    headers: { authorization: `Bearer ${currentToken}` }, data: { nextPublicKey, proof },
  })
  expect(begun.status()).toBe(201)
  const challenge = await begun.json() as { credentialId: string; challenge: string }
  const signature = Buffer.from(await crypto.subtle.sign('Ed25519', nextKeys.privateKey,
    new TextEncoder().encode(`support-tower-rotation:${challenge.credentialId}:${challenge.challenge}`))).toString('base64url')
  const confirmed = await request.post('/api/v1/credentials/rotate/confirm', {
    headers: { authorization: `Bearer ${currentToken}` },
    data: { credentialId: challenge.credentialId, challenge: challenge.challenge, signature, overlapSeconds: 3600 },
  })
  expect(confirmed.status()).toBe(200)

  await exchangeServiceToken(request, connector)
  await exchangeServiceToken(request, connector, nextKeys.privateKey, challenge.credentialId)
  // Confirmation timestamps are committed by the server. Use a fresh
  // revocation boundary so both overlap credentials are authoritative active.
  const revokeAt = new Date(Date.now() + 1_000)
  await revokeCredential({
    db: drizzle(scenario.db, { schema }), appId: connector.appId, credentialId: connector.credentialId,
    actorId: 'task22-admin', actorType: 'USER', correlationId: randomUUID(), now: revokeAt,
  })
  const oldNow = Math.floor(Date.now() / 1_000)
  const oldAssertion = await new SignJWT({ scope: 'escalations:write credentials:rotate' })
    .setProtectedHeader({ alg: 'EdDSA', kid: connector.credentialId }).setIssuer(connector.appId).setSubject(connector.appId)
    .setAudience(connector.audience).setIssuedAt(oldNow).setExpirationTime(oldNow + 60).setJti(randomUUID()).sign(connector.privateKey)
  const rejected = await request.post('/api/v1/service-tokens', { data: { clientAssertion: oldAssertion } })
  expect(rejected.status()).toBe(401)
  await exchangeServiceToken(request, connector, nextKeys.privateKey, challenge.credentialId)
})
