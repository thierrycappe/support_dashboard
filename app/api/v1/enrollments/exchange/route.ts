import { z } from 'zod'
import { exchangeEnrollment, getTrustedClientIp, publicError, publicJson, readJsonBody, requestCorrelationId, RequestBodyError, requireJsonContentType, UnsupportedMediaTypeError } from '@/lib/service-auth/guards'
import { validateEd25519PublicJwk } from '@/lib/service-auth/jwk'
import { ServiceRateLimitError } from '@/lib/service-auth/rate-limit'

const bodySchema = z.object({
  grant: z.object({ id: z.string().min(1).max(200), secret: z.string().min(1).max(512) }).strict(),
  publicKey: z.unknown(),
  connector: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(100),
    environment: z.string().min(1).max(100),
    baseUrl: z.string().url().refine((value) => ['https:', 'http:'].includes(new URL(value).protocol)),
  }).strict(),
}).strict()
const BODY_LIMIT = 16 * 1024
const CONNECTION_AUDIENCE = 'support-tower'

class InvalidClientIpError extends Error {}

export async function handleEnrollmentExchange(request: Request, deps: {
  exchange?: typeof exchangeEnrollment
  trustedClientIp?: typeof getTrustedClientIp
  publicOrigin?: string
} = {}): Promise<Response> {
  const correlationId = requestCorrelationId(request)
  try {
    requireJsonContentType(request)
    const body = bodySchema.parse(await readJsonBody(request, BODY_LIMIT))
    const publicJwk = validateEd25519PublicJwk(body.publicKey)
    const clientIp = (deps.trustedClientIp ?? getTrustedClientIp)(request)
    if (!clientIp) throw new InvalidClientIpError()
    const result = await (deps.exchange ?? exchangeEnrollment)({
      grantId: body.grant.id, invitation: body.grant.secret, publicJwk, clientIp, correlationId,
    })
    if (result.kind === 'invalid') return publicError(401, 'INVALID_INVITATION', 'Invitation is no longer valid', correlationId)
    const origin = trustedPublicOrigin(deps.publicOrigin)
    return publicJson({
      appId: result.appId, credentialId: result.credentialId, keyId: result.keyId,
      issuer: origin, audience: CONNECTION_AUDIENCE,
      tokenEndpoint: `${origin}/api/v1/service-tokens`, ingestEndpoint: `${origin}/api/v1/escalations`,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return publicError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', correlationId)
    if (error instanceof InvalidClientIpError) return publicError(400, 'INVALID_CLIENT_IP', 'Client IP address is invalid', correlationId)
    if (error instanceof RequestBodyError || error instanceof z.ZodError || (error instanceof Error && error.message === 'Invalid Ed25519 public JWK')) {
      return publicError(error instanceof RequestBodyError && error.kind === 'too_large' ? 413 : 400,
        error instanceof RequestBodyError && error.kind === 'too_large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
        error instanceof RequestBodyError && error.kind === 'too_large' ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    if (error instanceof ServiceRateLimitError) return publicError(429, 'RATE_LIMITED', 'Too many requests', correlationId, { 'Retry-After': String(error.retryAfterSeconds) })
    return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
  }
}

function trustedPublicOrigin(override?: string): string {
  const configured = override ?? process.env.SUPPORT_TOWER_PUBLIC_URL
  if (!configured) throw new Error('Public origin is not configured')
  const url = new URL(configured)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Public origin is invalid')
  }
  return url.origin
}

export async function POST(request: Request): Promise<Response> {
  return handleEnrollmentExchange(request)
}
