import { describe, expect, it, vi } from 'vitest'
import { handleApplicationRegistration } from '@/app/api/v1/app-registrations/route'
import { ProvisioningAuthError } from '@/lib/auth/provisioning'

const publicKey = { kty: 'OKP' as const, crv: 'Ed25519' as const, x: '11qYAYdk9JmseBDYzK6h4Zl8-QAjhqffIv2fjd3puEk' }
const body = {
  name: 'Beacon', slug: 'beacon', baseUrl: 'https://beacon.example.test', environment: 'production' as const,
  ownerIds: ['owner-1'], publicKey, vercelProjectId: 'project-1', vercelTeamId: 'team-1',
}
const request = (value: unknown = body, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request('https://tower.test/api/v1/app-registrations', { method: 'POST', headers, body: JSON.stringify(value) })

describe('application registration route', () => {
  it('returns the public endpoint contract for a new registration', async () => {
    const register = vi.fn().mockResolvedValue({ created: true, appId: 'app-1', credentialId: 'credential-1', keyId: 'thumbprint-1' })
    const response = await handleApplicationRegistration(request(), {
      authorize: vi.fn().mockReturnValue({ actorId: 'admin-1', teamId: 'team-1' }), register,
      publicOrigin: 'https://tower.test',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      created: true, appId: 'app-1', credentialId: 'credential-1', keyId: 'thumbprint-1',
      issuer: 'https://tower.test', audience: 'https://tower.test/api/v1/service-tokens',
      tokenEndpoint: 'https://tower.test/api/v1/service-tokens', ingestEndpoint: 'https://tower.test/api/v1/escalations',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'admin-1', configuredTeamId: 'team-1', input: body }))
  })

  it('fails closed for unsupported content and maps auth failures safely', async () => {
    const unsupported = await handleApplicationRegistration(request(body, { 'content-type': 'text/plain' }), {
      authorize: vi.fn(), publicOrigin: 'https://tower.test',
    })
    expect(unsupported.status).toBe(415)
    const invalid = await handleApplicationRegistration(request(), {
      authorize: vi.fn(() => { throw new Error('invalid') }), publicOrigin: 'https://tower.test',
    })
    expect(invalid.status).toBe(503)
    expect(await invalid.text()).not.toContain('invalid')
  })

  it('rejects duplicate owners, oversized payloads, and private JWKs before mutation', async () => {
    const authorize = vi.fn().mockReturnValue({ actorId: 'admin-1', teamId: 'team-1' })
    const register = vi.fn()
    const duplicateOwners = await handleApplicationRegistration(request({ ...body, ownerIds: ['owner-1', 'owner-1'] }), { authorize, register, publicOrigin: 'https://tower.test' })
    expect(duplicateOwners.status).toBe(400)
    const oversized = await handleApplicationRegistration(request({ ...body, name: 'x'.repeat(17_000) }), { authorize, register, publicOrigin: 'https://tower.test' })
    expect(oversized.status).toBe(413)
    const privateKey = await handleApplicationRegistration(request({ ...body, publicKey: { ...publicKey, d: 'private-material' } }), { authorize, register, publicOrigin: 'https://tower.test' })
    expect(privateKey.status).toBe(400)
    expect(register).not.toHaveBeenCalled()
  })

  it('maps invalid registration credentials and missing configuration without leaking details', async () => {
    const invalid = await handleApplicationRegistration(request(), {
      authorize: vi.fn(() => { throw new ProvisioningAuthError('INVALID_CREDENTIAL') }), publicOrigin: 'https://tower.test',
    })
    expect(invalid.status).toBe(401)
    expect(await invalid.text()).not.toContain('RegistrationAuthError')
    const missing = await handleApplicationRegistration(request(), {
      authorize: vi.fn(() => { throw new ProvisioningAuthError('CONFIGURATION') }), publicOrigin: 'https://tower.test',
    })
    expect(missing.status).toBe(503)
  })
})
