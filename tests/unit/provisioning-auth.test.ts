import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authorizeProvisioningRequest, getProvisioningConfiguration, ProvisioningAuthError } from '@/lib/auth/provisioning'

const secret = 'bootstrap-secret'
const digest = createHash('sha256').update(secret).digest('hex')
const env = {
  SUPPORT_TOWER_REGISTRATION_TOKEN_SHA256: digest,
  SUPPORT_TOWER_REGISTRATION_ACTOR_ID: 'admin-1',
  SUPPORT_TOWER_REGISTRATION_TEAM_ID: 'team-1',
}

describe('trusted registration authorization', () => {
  it('requires complete configuration and a matching bearer secret', () => {
    expect(getProvisioningConfiguration(env)).toEqual({ actorId: 'admin-1', teamId: 'team-1' })
    expect(() => getProvisioningConfiguration({ ...env, SUPPORT_TOWER_REGISTRATION_TOKEN_SHA256: 'secret' }))
      .toThrowError(new ProvisioningAuthError('CONFIGURATION'))
    expect(() => authorizeProvisioningRequest(new Request('https://tower.test', { headers: { authorization: 'Bearer wrong' } }), env))
      .toThrowError(new ProvisioningAuthError('INVALID_CREDENTIAL'))
  })

  it('accepts the configured secret without exposing it in the result', () => {
    expect(authorizeProvisioningRequest(new Request('https://tower.test', { headers: { authorization: `Bearer ${secret}` } }), env))
      .toEqual({ actorId: 'admin-1', teamId: 'team-1' })
  })
})
