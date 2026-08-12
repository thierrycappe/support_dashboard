import { z } from 'zod'
import type { ServicePrincipal } from '@/lib/service-auth/assertions'
import { AccessTokenVerificationError } from '@/lib/service-auth/access-tokens'
import { confirmCredentialRotation, RotationError } from '@/lib/service-auth/credentials'
import {
  publicError, publicJson, readJsonBody, requestCorrelationId, RequestBodyError,
  requireJsonContentType, requireServicePrincipal, UnsupportedMediaTypeError,
} from '@/lib/service-auth/guards'

const MAX_BODY_BYTES = 20 * 1024
const bodySchema = z.object({
  credentialId: z.string().min(1).max(200),
  challenge: z.string().min(1).max(1_024),
  signature: z.string().min(1).max(1_024),
  overlapSeconds: z.number().int().nonnegative(),
}).strict()

type Confirm = typeof confirmCredentialRotation

export async function handleCredentialRotationConfirmation(request: Request, deps: {
  principal?: (request: Request) => Promise<ServicePrincipal>
  confirm?: Confirm
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
    const result = await (deps.confirm ?? confirmCredentialRotation)({
      principal, credentialId: body.credentialId, challenge: body.challenge, signature: body.signature,
      overlapSeconds: body.overlapSeconds, correlationId,
    })
    return publicJson({
      credentialId: result.credentialId,
      status: 'ACTIVE',
      oldCredentialValidUntil: result.oldCredentialValidUntil.toISOString(),
    })
  } catch (error) {
    if (error instanceof RotationError) return publicError(401, 'INVALID_ROTATION_CHALLENGE', 'Credential rotation challenge is invalid', correlationId)
    if (error instanceof RequestBodyError || error instanceof z.ZodError) {
      const tooLarge = error instanceof RequestBodyError && error.kind === 'too_large'
      return publicError(tooLarge ? 413 : 400, tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST', tooLarge ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    return unavailable(correlationId)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleCredentialRotationConfirmation(request)
}

function unavailable(correlationId: string): Response {
  return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
}
