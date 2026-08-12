import { z } from 'zod'
import { exchangeEnrollment, getTrustedClientIp, publicError, readJsonBody, requestCorrelationId, RequestBodyError } from '@/lib/service-auth/guards'
import { validateEd25519PublicJwk } from '@/lib/service-auth/jwk'
import { ServiceRateLimitError } from '@/lib/service-auth/rate-limit'

const bodySchema = z.object({ invitation: z.string().min(1).max(512), publicJwk: z.unknown() }).strict()
const BODY_LIMIT = 16 * 1024

export async function handleEnrollmentExchange(request: Request, deps: {
  exchange?: typeof exchangeEnrollment
  trustedClientIp?: typeof getTrustedClientIp
} = {}): Promise<Response> {
  const correlationId = requestCorrelationId(request)
  try {
    const body = bodySchema.parse(await readJsonBody(request, BODY_LIMIT))
    const publicJwk = validateEd25519PublicJwk(body.publicJwk)
    const result = await (deps.exchange ?? exchangeEnrollment)({
      invitation: body.invitation, publicJwk,
      clientIp: (deps.trustedClientIp ?? getTrustedClientIp)(request), correlationId,
    })
    if (result.kind === 'invalid') return publicError(401, 'INVALID_INVITATION', 'Invitation is no longer valid', correlationId)
    return Response.json({ appId: result.appId, credentialId: result.credentialId }, { status: 201 })
  } catch (error) {
    if (error instanceof RequestBodyError || error instanceof z.ZodError || (error instanceof Error && error.message === 'Invalid Ed25519 public JWK')) {
      return publicError(error instanceof RequestBodyError && error.kind === 'too_large' ? 413 : 400,
        error instanceof RequestBodyError && error.kind === 'too_large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
        error instanceof RequestBodyError && error.kind === 'too_large' ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    if (error instanceof ServiceRateLimitError) return publicError(429, 'RATE_LIMITED', 'Too many requests', correlationId, { 'Retry-After': String(error.retryAfterSeconds) })
    return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleEnrollmentExchange(request)
}
