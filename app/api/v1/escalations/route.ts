import { z } from 'zod'
import { getDb } from '@/lib/db'
import { scheduleDeliveryWakeup } from '@/lib/delivery/worker'
import { escalationV1Schema, MAX_ESCALATION_V1_BODY_BYTES } from '@/lib/escalations/contract'
import { IntakeError } from '@/lib/escalations/errors'
import { acceptEscalation, type IntakeResult } from '@/lib/escalations/intake'
import { resolveTargetsFromDb } from '@/lib/escalations/repository'
import type { ServicePrincipal } from '@/lib/service-auth/assertions'
import { publicError, readJsonBody, requestCorrelationId, RequestBodyError, requireIdempotencyKey, requireServicePrincipal } from '@/lib/service-auth/guards'
import { consumeRequiredLimits, serviceRateLimits, ServiceRateLimitError } from '@/lib/service-auth/rate-limit'

type Accept = (input: Parameters<typeof acceptEscalation>[0]) => Promise<IntakeResult>

export async function acceptVersionedEscalation(input: Parameters<typeof acceptEscalation>[0]): Promise<IntakeResult> {
  return acceptEscalation(input, {
    db: getDb(),
    scheduleDeliveryWakeup: () => undefined,
    resolveTargets: resolveTargetsFromDb,
    beforeAcceptance: (tx) => consumeRequiredLimits(tx, [{
      scope: 'intake:app', subject: input.appId, ...serviceRateLimits.ingestApp,
    }]),
  })
}

export async function handleEscalation(request: Request, deps: {
  principal?: (request: Request) => Promise<ServicePrincipal>
  accept?: Accept
  wakeup?: () => void
  maxBodyBytes?: number
} = {}): Promise<Response> {
  const correlationId = requestCorrelationId(request)
  let principal: ServicePrincipal
  try {
    principal = await (deps.principal ?? ((value) => requireServicePrincipal(value, ['escalations:write'])))(request)
  } catch {
    return publicError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid', correlationId)
  }
  try {
    const idempotencyKey = requireIdempotencyKey(request.headers)
    const command = escalationV1Schema.parse(await readJsonBody(request, deps.maxBodyBytes ?? MAX_ESCALATION_V1_BODY_BYTES))
    const result = await (deps.accept ?? acceptVersionedEscalation)({
      appId: principal.appId, credentialId: principal.credentialId, idempotencyKey, command,
    })
    if (result.result !== 'duplicate') (deps.wakeup ?? scheduleDeliveryWakeup)()
    return Response.json({ appId: result.appId, ticketId: result.ticketId, result: result.result }, { status: result.result === 'created' ? 201 : 200 })
  } catch (error) {
    if (error instanceof ServiceRateLimitError) return publicError(429, 'RATE_LIMITED', 'Too many requests', correlationId, { 'Retry-After': String(error.retryAfterSeconds) })
    if (error instanceof IntakeError) return publicError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key conflicts with an accepted request', correlationId)
    if (error instanceof RequestBodyError || error instanceof z.ZodError) {
      const tooLarge = error instanceof RequestBodyError && error.kind === 'too_large'
      return publicError(tooLarge ? 413 : 400, tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST', tooLarge ? 'Request body is too large' : 'Request body is invalid', correlationId)
    }
    return publicError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable', correlationId)
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleEscalation(request)
}
