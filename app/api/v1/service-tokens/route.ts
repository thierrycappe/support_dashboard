import { z } from 'zod'
import { getDb, type DbTransaction } from '@/lib/db'
import { issueServiceAccessToken } from '@/lib/service-auth/access-tokens'
import { recordAssertionReplay, verifyClientAssertion, type ServiceScope } from '@/lib/service-auth/assertions'
import { getActiveCredential } from '@/lib/service-auth/credentials'
import { publicError, publicJson, readJsonBody, requestCorrelationId, RequestBodyError, requireJsonContentType, UnsupportedMediaTypeError } from '@/lib/service-auth/guards'
import { consumeRequiredLimits, ServiceRateLimitError, tokenCredentialRequiredLimits } from '@/lib/service-auth/rate-limit'

const bodySchema = z.object({ clientAssertion: z.string().min(1).max(16_384) }).strict()

export async function exchangeClientAssertion(assertion: string): Promise<{ accessToken: string; scopes: ServiceScope[] }> {
  return getDb().transaction(async (tx) => {
    const principal = await verifyClientAssertion({
      db: tx as never, assertion, audience: 'support-tower-service',
      getCredential: (args) => getActiveCredential({ ...args, db: tx as never }),
      recordReplay: (args) => recordAssertionReplay({ ...args, db: tx as never }),
    })
    await consumeRequiredLimits(tx as DbTransaction, tokenCredentialRequiredLimits(principal.credentialId))
    try {
      return { accessToken: await issueServiceAccessToken({ principal, expiresInSeconds: 300 }), scopes: principal.scopes }
    } catch {
      throw new ServiceTokenIssueError()
    }
  })
}

class ServiceTokenIssueError extends Error {
  readonly code = 'SERVICE_TOKEN_ISSUE'
  constructor() { super('Service token issuance failed'); this.name = 'ServiceTokenIssueError' }
}

export async function handleServiceToken(request: Request, deps: { exchangeAssertion?: typeof exchangeClientAssertion } = {}): Promise<Response> {
  const correlationId = requestCorrelationId(request)
  try {
    requireJsonContentType(request)
    const body = bodySchema.parse(await readJsonBody(request, 20 * 1024))
    const result = await (deps.exchangeAssertion ?? exchangeClientAssertion)(body.clientAssertion)
    return publicJson({ accessToken: result.accessToken, tokenType: 'Bearer', expiresIn: 300, scope: result.scopes.join(' ') })
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) return publicError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', correlationId)
    if (error instanceof RequestBodyError || error instanceof z.ZodError) {
      const tooLarge = error instanceof RequestBodyError && error.kind === 'too_large'
      return publicError(tooLarge ? 413 : 400, tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST', tooLarge ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    if (error instanceof ServiceRateLimitError) return publicError(429, 'RATE_LIMITED', 'Too many requests', correlationId, { 'Retry-After': String(error.retryAfterSeconds) })
    if (isPersistenceError(error)) return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
    return publicError(401, 'INVALID_CLIENT_ASSERTION', 'Client assertion is invalid', correlationId)
  }
}

function isPersistenceError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof (current as { code?: unknown }).code === 'string') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export async function POST(request: Request): Promise<Response> {
  return handleServiceToken(request)
}
