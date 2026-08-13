// scaffold:scenario:SCN-008:a70e93c6
import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { enrollConnector, exchangeServiceToken, expect, test } from '../../helpers/fixtures'

test('SCN-008 — an admin assists rotation, observes overlap, and revokes the superseded key', async ({ page, request, scenario }) => {
  const connector = await enrollConnector(request, scenario, 'rotation')
  const currentToken = await exchangeServiceToken(request, connector)
  const nextKeys = await generateKeyPair('EdDSA', { extractable: true })
  const nextPublicKey = await exportJWK(nextKeys.publicKey) as Record<string, unknown>

  await page.goto(`/apps/${connector.appId}`)
  await expect(page.getByRole('heading', { name: 'Credential health' })).toBeVisible()
  await page.getByLabel('Current active credential').selectOption(connector.credentialId)
  await page.getByLabel('New Ed25519 public JWK').fill(JSON.stringify(nextPublicKey))
  await page.getByRole('button', { name: 'Begin key rotation' }).click()
  const reveal = page.locator('.credential-challenge')
  await expect(reveal.getByRole('heading', { name: 'Confirm the new key' })).toBeVisible()
  const nextCredentialId = (await reveal.locator('dd code').nth(0).innerText()).trim()
  const challenge = (await reveal.locator('dd code').nth(1).innerText()).trim()
  expect(challenge).not.toBe('')
  const signature = Buffer.from(await crypto.subtle.sign('Ed25519', nextKeys.privateKey,
    new TextEncoder().encode(`support-tower-rotation:${nextCredentialId}:${challenge}`))).toString('base64url')
  const confirmed = await request.post('/api/v1/credentials/rotate/confirm', {
    headers: { authorization: `Bearer ${currentToken}` },
    data: { credentialId: nextCredentialId, challenge, signature, overlapSeconds: 3600 },
  })
  expect(confirmed.status()).toBe(200)

  await exchangeServiceToken(request, connector)
  await exchangeServiceToken(request, connector, nextKeys.privateKey, nextCredentialId)
  await page.reload()
  const oldCredential = page.locator('.credential-row').filter({ has: page.locator(`#credential-${connector.credentialId}`) })
  const nextCredential = page.locator('.credential-row').filter({ has: page.locator(`#credential-${nextCredentialId}`) })
  await expect(oldCredential.getByText('Overlap', { exact: true })).toBeVisible()
  await expect(nextCredential.getByText('Active', { exact: true })).toBeVisible()
  await oldCredential.getByRole('button', { name: `Revoke credential ${connector.credentialId}` }).click()
  await expect(oldCredential.getByRole('status')).toHaveText('Credential revoked')

  const oldNow = Math.floor(Date.now() / 1_000)
  const oldAssertion = await new SignJWT({ scope: 'escalations:write credentials:rotate' })
    .setProtectedHeader({ alg: 'EdDSA', kid: connector.credentialId }).setIssuer(connector.appId).setSubject(connector.appId)
    .setAudience(connector.audience).setIssuedAt(oldNow).setExpirationTime(oldNow + 60).setJti(randomUUID()).sign(connector.privateKey)
  const rejected = await request.post('/api/v1/service-tokens', { data: { clientAssertion: oldAssertion } })
  expect(rejected.status()).toBe(401)
  await exchangeServiceToken(request, connector, nextKeys.privateKey, nextCredentialId)
})
