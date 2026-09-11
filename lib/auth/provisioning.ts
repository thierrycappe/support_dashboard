import { createHash, timingSafeEqual } from 'node:crypto'

export type ProvisioningEnvironment = Record<string, string | undefined>

export class ProvisioningAuthError extends Error {
  constructor(readonly code: 'CONFIGURATION' | 'INVALID_CREDENTIAL') {
    super(code)
    this.name = 'ProvisioningAuthError'
  }
}

export interface ProvisioningAuthorization {
  actorId: string
  teamId: string
}

export function getProvisioningConfiguration(env: ProvisioningEnvironment = process.env): ProvisioningAuthorization {
  const digest = env.SUPPORT_TOWER_REGISTRATION_TOKEN_SHA256?.trim()
  const actorId = env.SUPPORT_TOWER_REGISTRATION_ACTOR_ID?.trim()
  const teamId = env.SUPPORT_TOWER_REGISTRATION_TEAM_ID?.trim()
  if (!digest || !/^[a-f0-9]{64}$/i.test(digest) || !actorId || !teamId) {
    throw new ProvisioningAuthError('CONFIGURATION')
  }
  return { actorId, teamId }
}

export function authorizeProvisioningRequest(
  request: Request,
  env: ProvisioningEnvironment = process.env,
): ProvisioningAuthorization {
  const configured = getProvisioningConfiguration(env)
  const authorization = request.headers.get('authorization')
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    throw new ProvisioningAuthError('INVALID_CREDENTIAL')
  }

  const actual = createHash('sha256').update(authorization.slice(7), 'utf8').digest()
  const expected = Buffer.from(env.SUPPORT_TOWER_REGISTRATION_TOKEN_SHA256!.trim(), 'hex')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ProvisioningAuthError('INVALID_CREDENTIAL')
  }
  return configured
}
