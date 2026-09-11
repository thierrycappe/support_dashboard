// scaffold:scenario:SCN-011:7026f033
import { exportJWK, generateKeyPair } from 'jose'
import { expect, test, exchangeServiceToken } from '../../helpers/fixtures'

const registrationToken = 'task11-fictional-provisioning-token-for-local-tests'

test('SCN-011 — an authorized agent registers once and its app can authenticate', async ({ request, scenario }) => {
  const keys = await generateKeyPair('EdDSA', { extractable: true })
  const body = {
    name: 'Agent registration fixture', slug: `${scenario.id}-agent`, baseUrl: 'https://agent.example.test',
    environment: 'preview', ownerIds: ['task22-admin'], publicKey: await exportJWK(keys.publicKey),
    vercelTeamId: 'team_Task22', vercelProjectId: `prj_${scenario.id.replaceAll('-', '')}`,
  }
  const denied = await request.post('/api/v1/app-registrations', { data: body })
  expect(denied.status()).toBe(401)
  const headers = { authorization: `Bearer ${registrationToken}` }
  const created = await request.post('/api/v1/app-registrations', { headers, data: body })
  expect(created.status()).toBe(201)
  expect(created.headers()['cache-control']).toBe('no-store')
  const registration = await created.json()
  expect(registration.created).toBe(true)
  expect(registration.appId).toBeTruthy()
  expect(registration.credentialId).toBeTruthy()
  const retry = await request.post('/api/v1/app-registrations', { headers, data: body })
  expect(retry.status()).toBe(200)
  expect(await retry.json()).toEqual({ ...registration, created: false })
  const accessToken = await exchangeServiceToken(request, { ...registration, privateKey: keys.privateKey, publicKey: body.publicKey })
  expect(accessToken.length).toBeGreaterThan(20)
  const replacement = await generateKeyPair('EdDSA', { extractable: true })
  const conflict = await request.post('/api/v1/app-registrations', { headers, data: { ...body, publicKey: await exportJWK(replacement.publicKey) } })
  expect(conflict.status()).toBe(409)
  const otherTeam = await request.post('/api/v1/app-registrations', { headers, data: { ...body, vercelTeamId: 'team_other' } })
  expect(otherTeam.status()).toBe(403)
})
