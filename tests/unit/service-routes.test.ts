// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { IntakeError } from '@/lib/escalations/errors'
import { ServiceRateLimitError } from '@/lib/service-auth/rate-limit'
import { handleEnrollmentExchange } from '@/app/api/v1/enrollments/exchange/route'
import { handleServiceToken } from '@/app/api/v1/service-tokens/route'
import { handleEscalation } from '@/app/api/v1/escalations/route'
import { AccessTokenVerificationError } from '@/lib/service-auth/access-tokens'

const correlationId = 'correlation-123'

describe('versioned service route contracts', () => {
  it('returns stable enrollment and token success envelopes', async () => {
    const enrollment = await handleEnrollmentExchange(request('/enrollments/exchange', enrollmentBody()), {
      exchange: vi.fn(async () => ({ kind: 'created' as const, appId: 'app-1', credentialId: 'credential-1', keyId: 'thumbprint-1' })),
      trustedClientIp: () => '203.0.113.1',
      publicOrigin: 'https://support.example.com',
    })
    expect(enrollment.status).toBe(201)
    await expect(enrollment.json()).resolves.toEqual({
      appId: 'app-1', credentialId: 'credential-1', keyId: 'thumbprint-1', issuer: 'https://support.example.com',
      audience: 'support-tower', tokenEndpoint: 'https://support.example.com/api/v1/service-tokens',
      ingestEndpoint: 'https://support.example.com/api/v1/escalations',
    })

    const token = await handleServiceToken(request('/service-tokens', { clientAssertion: 'assertion' }), {
      exchangeAssertion: vi.fn(async () => ({ accessToken: 'access-token', scopes: ['escalations:write', 'credentials:rotate'] as Array<'escalations:write' | 'credentials:rotate'> })),
    })
    expect(token.status).toBe(200)
    await expect(token.json()).resolves.toEqual({ accessToken: 'access-token', tokenType: 'Bearer', expiresIn: 300, scope: 'escalations:write credentials:rotate' })
    expect(enrollment.headers.get('cache-control')).toBe('no-store')
    expect(token.headers.get('cache-control')).toBe('no-store')
  })

  it('returns a stable 401 without echoing reused invitation or assertion data', async () => {
    const exchange = vi.fn(async () => ({ kind: 'invalid' as const }))
    const enrollment = await handleEnrollmentExchange(request('/enrollments/exchange', enrollmentBody('top-secret-invite')), { exchange, trustedClientIp: () => '203.0.113.1' })
    expect(await error(enrollment)).toEqual([401, 'INVALID_INVITATION'])
    expect(await enrollment.clone().text()).not.toContain('top-secret-invite')

    const token = await handleServiceToken(request('/service-tokens', { clientAssertion: 'top-secret-assertion' }), {
      exchangeAssertion: vi.fn(async () => { throw new Error('provider top-secret-assertion') }),
    })
    expect(await error(token)).toEqual([401, 'INVALID_CLIENT_ASSERTION'])
    expect(await token.clone().text()).not.toContain('top-secret-assertion')
  })

  it('returns a sanitized 503 when token persistence fails', async () => {
    const response = await handleServiceToken(request('/service-tokens', { clientAssertion: 'assertion' }), {
      exchangeAssertion: vi.fn(async () => { throw Object.assign(new Error('database password'), { code: '08006' }) }),
    })

    expect(await error(response)).toEqual([503, 'SERVICE_UNAVAILABLE'])
    expect(await response.clone().text()).not.toContain('database password')
  })

  it('distinguishes access-token persistence/config failures from invalid credentials', async () => {
    const unavailable = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'unavailable' }), {
      principal: vi.fn(async () => { throw new AccessTokenVerificationError('unavailable') }), accept: vi.fn(), wakeup: vi.fn(),
    })
    expect(await error(unavailable)).toEqual([503, 'SERVICE_UNAVAILABLE'])

    const invalid = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'invalid' }), {
      principal: vi.fn(async () => { throw new AccessTokenVerificationError('invalid') }), accept: vi.fn(), wakeup: vi.fn(),
    })
    expect(await error(invalid)).toEqual([401, 'INVALID_ACCESS_TOKEN'])
  })

  it.each([
    ['missing', undefined], ['malformed', 'not-an-ip'], ['multiple', '203.0.113.1, 203.0.113.2'],
  ])('rejects %s trusted enrollment client IP without entering exchange', async (_name, forwarded) => {
    const exchange = vi.fn()
    const headers: Record<string, string> = forwarded === undefined ? {} : { 'x-vercel-forwarded-for': forwarded }
    const response = await handleEnrollmentExchange(request('/enrollments/exchange', enrollmentBody(), headers), { exchange })
    expect(await error(response)).toEqual([400, 'INVALID_CLIENT_IP'])
    expect(exchange).not.toHaveBeenCalled()
  })

  it.each(['/enrollments/exchange', '/service-tokens', '/escalations'])('requires JSON media type and disables caching for %s errors', async (path) => {
    const headers: Record<string, string> = path === '/escalations' ? { authorization: 'Bearer token', 'idempotency-key': 'media' } : {}
    const response = path === '/enrollments/exchange'
      ? await handleEnrollmentExchange(request(path, enrollmentBody(), headers, 'text/plain'), { exchange: vi.fn(), trustedClientIp: () => '203.0.113.1' })
      : path === '/service-tokens'
        ? await handleServiceToken(request(path, { clientAssertion: 'assertion' }, headers, 'text/plain'), { exchangeAssertion: vi.fn() })
        : await handleEscalation(request(path, escalationBody(), headers, 'text/plain'), { principal: vi.fn(async () => ({ appId: 'app-1', credentialId: 'credential-1', scopes: ['escalations:write' as const] })), accept: vi.fn(), wakeup: vi.fn() })
    expect(await error(response)).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE'])
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('maps independent rate limits to exact 429 Retry-After responses', async () => {
    const limited = new ServiceRateLimitError({ allowed: false, remaining: 0, retryAfterSeconds: 17 }, 'test')
    const enrollment = await handleEnrollmentExchange(request('/enrollments/exchange', enrollmentBody()), {
      exchange: vi.fn(async () => { throw limited }), trustedClientIp: () => '203.0.113.1',
    })
    const token = await handleServiceToken(request('/service-tokens', { clientAssertion: 'assertion' }), {
      exchangeAssertion: vi.fn(async () => { throw limited }),
    })
    const escalation = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'once' }), {
      principal: vi.fn(async () => ({ appId: 'app-1', credentialId: 'credential-1', scopes: ['escalations:write' as const] })),
      accept: vi.fn(async () => { throw limited }), wakeup: vi.fn(),
    })
    for (const response of [enrollment, token, escalation]) {
      expect(await error(response)).toEqual([429, 'RATE_LIMITED'])
      expect(response.headers.get('retry-after')).toBe('17')
    }
  })

  it('maps escalation created, duplicate, conflict, oversized, revoked, and persistence failure', async () => {
    const base = { principal: vi.fn(async () => ({ appId: 'app-1', credentialId: 'credential-1', scopes: ['escalations:write' as const] })), wakeup: vi.fn() }
    const created = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'created' }), {
      ...base, accept: vi.fn(async () => ({ appId: 'app-1', ticketId: 'ticket-1', result: 'created' as const, acceptedAt: new Date('2026-08-12T12:00:01.000Z') })),
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({ ticketId: 'ticket-1', result: 'created', acceptedAt: '2026-08-12T12:00:01.000Z' })
    expect(created.headers.get('cache-control')).toBe('no-store')
    expect(base.wakeup).toHaveBeenCalledOnce()

    const duplicateWakeup = vi.fn()
    const duplicate = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'duplicate' }), {
      ...base, wakeup: duplicateWakeup, accept: vi.fn(async () => ({ appId: 'app-1', ticketId: 'ticket-1', result: 'duplicate' as const, acceptedAt: new Date() })),
    })
    expect(duplicate.status).toBe(200)
    expect(duplicateWakeup).not.toHaveBeenCalled()

    const conflict = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'conflict' }), {
      ...base, accept: vi.fn(async () => { throw new IntakeError('IDEMPOTENCY_CONFLICT') }),
    })
    expect(await error(conflict)).toEqual([409, 'IDEMPOTENCY_CONFLICT'])

    const oversized = await handleEscalation(new Request('https://tower/api/v1/escalations', {
      method: 'POST', headers: { authorization: 'Bearer token', 'idempotency-key': 'large', 'x-correlation-id': correlationId, 'content-type': 'application/json' }, body: JSON.stringify({ description: 'x'.repeat(300_000) }),
    }), { ...base, accept: vi.fn(), maxBodyBytes: 1024 })
    expect(await error(oversized)).toEqual([413, 'PAYLOAD_TOO_LARGE'])

    const revoked = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer revoked', 'idempotency-key': 'revoked' }), {
      ...base, principal: vi.fn(async () => { throw new Error('revoked token') }), accept: vi.fn(),
    })
    expect(await error(revoked)).toEqual([401, 'INVALID_ACCESS_TOKEN'])

    const failedWakeup = vi.fn()
    const failed = await handleEscalation(request('/escalations', escalationBody(), { authorization: 'Bearer token', 'idempotency-key': 'failed' }), {
      ...base, wakeup: failedWakeup, accept: vi.fn(async () => { throw new Error('postgres password') }),
    })
    expect(await error(failed)).toEqual([503, 'SERVICE_UNAVAILABLE'])
    expect(await failed.clone().text()).not.toContain('postgres password')
    expect(failedWakeup).not.toHaveBeenCalled()
  })

  it('binds escalation identity only from the verified principal', async () => {
    const accept = vi.fn(async () => ({ appId: 'trusted-app', ticketId: 'ticket-1', result: 'created' as const, acceptedAt: new Date() }))
    const response = await handleEscalation(request('/escalations', { ...escalationBody(), appId: 'attacker-app', credentialId: 'attacker-credential' }, {
      authorization: 'Bearer token', 'idempotency-key': 'identity',
    }), {
      principal: vi.fn(async () => ({ appId: 'trusted-app', credentialId: 'trusted-credential', scopes: ['escalations:write' as const] })), accept, wakeup: vi.fn(),
    })

    expect(response.status).toBe(400)
    expect(accept).not.toHaveBeenCalled()
  })
})

function request(path: string, body: unknown, headers: Record<string, string> = {}, contentType = 'application/json; charset=utf-8'): Request {
  return new Request(`https://tower/api/v1${path}`, {
    method: 'POST', headers: { 'content-type': contentType, 'x-correlation-id': correlationId, ...headers }, body: JSON.stringify(body),
  })
}

async function error(response: Response): Promise<[number, string]> {
  const body = await response.clone().json() as { error: { code: string; correlationId: string } }
  expect(body.error.correlationId).toBe(correlationId)
  return [response.status, body.error.code]
}

function jwk() { return { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) } }

function enrollmentBody(secret = 'invite') {
  return {
    grant: { id: 'grant-1', secret }, publicKey: jwk(),
    connector: { version: '1.0.0', environment: 'production', baseUrl: 'https://source.example.com' },
  }
}

function escalationBody() {
  return {
    schemaVersion: 1, externalId: 'external-1', classification: 'BUG', status: 'NEW', priority: 'HIGH',
    title: 'A bug', description: 'Details', sourceUrl: null,
    triage: { ownerRef: 'owner', ownerName: null, escalatedAt: '2026-08-12T12:00:00.000Z' },
    reporter: { name: null, email: null, sourceId: null }, browserInfo: null, markdownSpec: null,
    transcript: null, remoteCreatedAt: null, remoteUpdatedAt: null, metadata: {},
  }
}
