import { z } from 'zod'
import { registerApplication, ApplicationRegistrationError, type ApplicationRegistrationInput } from '@/lib/apps/registration'
import { authorizeProvisioningRequest, ProvisioningAuthError } from '@/lib/auth/provisioning'
import { applicationBaseUrlIssue } from '@/lib/apps/validation'
import { publicError, publicJson, readJsonBody, requestCorrelationId, RequestBodyError, requireJsonContentType, ServiceConfigurationError, serviceEndpointMetadata, UnsupportedMediaTypeError } from '@/lib/service-auth/guards'
import { validateEd25519PublicJwk } from '@/lib/service-auth/jwk'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  baseUrl: z.string().trim().min(1).max(2_000).refine((value) => applicationBaseUrlIssue(value) === null),
  environment: z.enum(['production', 'preview']),
  ownerIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Owner IDs must be unique' })
  }),
  publicKey: z.unknown(),
  vercelProjectId: z.string().trim().min(1).max(200),
  vercelTeamId: z.string().trim().min(1).max(200),
}).strict()
const BODY_LIMIT = 16 * 1024

export async function handleApplicationRegistration(request: Request, deps: {
  authorize?: typeof authorizeProvisioningRequest
  register?: typeof registerApplication
  publicOrigin?: string
  env?: Record<string, string | undefined>
} = {}): Promise<Response> {
  const correlationId = requestCorrelationId(request)
  try {
    requireJsonContentType(request)
    const authorization = await (deps.authorize ?? authorizeProvisioningRequest)(request, deps.env)
    const body = bodySchema.parse(await readJsonBody(request, BODY_LIMIT))
    const publicKey = validateEd25519PublicJwk(body.publicKey)
    const endpoints = serviceEndpointMetadata(deps.publicOrigin)
    const input: ApplicationRegistrationInput = { ...body, publicKey }
    const result = await (deps.register ?? registerApplication)({
      actorId: authorization.actorId, configuredTeamId: authorization.teamId, correlationId, input,
    })
    return publicJson({ ...result, ...endpoints }, { status: result.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return publicError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', correlationId)
    if (error instanceof ProvisioningAuthError) {
      return publicError(error.code === 'CONFIGURATION' ? 503 : 401, error.code === 'CONFIGURATION' ? 'SERVICE_UNAVAILABLE' : 'INVALID_CREDENTIAL', error.code === 'CONFIGURATION' ? 'Service temporarily unavailable' : 'Registration credential is invalid', correlationId)
    }
    if (error instanceof RequestBodyError || error instanceof z.ZodError || (error instanceof Error && error.message === 'Invalid Ed25519 public JWK')) {
      const tooLarge = error instanceof RequestBodyError && error.kind === 'too_large'
      return publicError(tooLarge ? 413 : 400, tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST', tooLarge ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    if (error instanceof ServiceConfigurationError) return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
    if (error instanceof ApplicationRegistrationError) return registrationErrorResponse(error, correlationId)
    return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
  }
}

function registrationErrorResponse(error: ApplicationRegistrationError, correlationId: string): Response {
  const conflict: Record<string, [string, string]> = {
    SLUG_CONFLICT: ['SLUG_CONFLICT', 'Application slug is already registered'],
    BINDING_CONFLICT: ['BINDING_CONFLICT', 'Vercel project binding is already registered'],
    KEY_CONFLICT: ['KEY_CONFLICT', 'Public key is already registered'],
  }
  if (conflict[error.code]) {
    const [code, message] = conflict[error.code]
    return publicError(409, code, message, correlationId)
  }
  if (error.code === 'TEAM_MISMATCH') return publicError(403, 'TEAM_MISMATCH', 'Registration team is not authorized', correlationId)
  if (error.code === 'ACTOR_FORBIDDEN') return publicError(403, 'ACTOR_FORBIDDEN', 'Registration actor is not authorized', correlationId)
  if (error.code === 'OWNER_NOT_FOUND') return publicError(403, 'OWNER_FORBIDDEN', 'One or more owners are not active', correlationId)
  return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
}

export async function POST(request: Request): Promise<Response> {
  return handleApplicationRegistration(request)
}
