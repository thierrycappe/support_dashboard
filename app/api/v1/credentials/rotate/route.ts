import { z } from 'zod'
import type { ServicePrincipal } from '@/lib/service-auth/assertions'
import { AccessTokenVerificationError } from '@/lib/service-auth/access-tokens'
import { beginCredentialRotation, RotationError } from '@/lib/service-auth/credentials'
import {
  publicError, publicJson, readJsonBody, requestCorrelationId, RequestBodyError,
  requireJsonContentType, requireServicePrincipal, UnsupportedMediaTypeError,
} from '@/lib/service-auth/guards'

const MAX_BODY_BYTES = 20 * 1024
const bodySchema = z.object({
  nextPublicKey: z.unknown(),
  proof: z.string().min(1).max(16_384),
}).strict()

type Begin = typeof beginCredentialRotation

export async function handleCredentialRotation(request: Request, deps: {
  principal?: (request: Request) => Promise<ServicePrincipal>
  begin?: Begin
  maxBodyBytes?: number
} = {}): Promise<Response> {
  const correlationId = requestCorrelationId(request)
  try {
    requireJsonContentType(request)
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return publicError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', correlationId)
    throw error
  }
  let principal: ServicePrincipal
  try {
    principal = await (deps.principal ?? ((value) => requireServicePrincipal(value, ['credentials:rotate'])))(request)
  } catch (error) {
    if (error instanceof AccessTokenVerificationError && error.kind === 'unavailable') return unavailable(correlationId)
    return publicError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid', correlationId)
  }
  try {
    const body = bodySchema.parse(await readJsonBody(request, deps.maxBodyBytes ?? MAX_BODY_BYTES))
    const result = await (deps.begin ?? beginCredentialRotation)({
      principal, nextPublicJwk: body.nextPublicKey, proof: body.proof, correlationId,
    })
    return publicJson({
      credentialId: result.credentialId,
      challenge: result.challenge,
      expiresAt: result.expiresAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof RotationError) {
      if (error.code === 'ROTATION_IN_PROGRESS' || error.code === 'DUPLICATE_CREDENTIAL') {
        return publicError(409, error.code, 'Credential rotation conflicts with current state', correlationId)
      }
      return publicError(401, 'INVALID_ROTATION_PROOF', 'Credential rotation proof is invalid', correlationId)
    }
    if (error instanceof RequestBodyError || error instanceof z.ZodError) {
      const tooLarge = error instanceof RequestBodyError && error.kind === 'too_large'
      return publicError(tooLarge ? 413 : 400, tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST', tooLarge ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    return unavailable(correlationId)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleCredentialRotation(request)
}

function unavailable(correlationId: string): Response {
  return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
}
