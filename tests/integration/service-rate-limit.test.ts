import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import {
  consumeRequiredLimits,
  consumeServiceRateLimit,
  getTrustedClientIp,
  serviceRateLimits,
  tokenCredentialRequiredLimits,
} from '@/lib/service-auth/rate-limit'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:30.000Z')

beforeEach(async () => { await getDb().execute(sql`truncate table service_rate_limit_buckets`) })
afterAll(async () => { await closeDbPool() })

describe('database-backed service rate limits', () => {
  it('allows the final request then denies the next with exact retry seconds and resets in a new window', async () => {
    for (let index = 0; index < 2; index += 1) {
      await expect(consumeServiceRateLimit({ tx: getDb(), scope: 'test', subject: 'one', limit: 2, windowMs: 60_000, now })).resolves.toMatchObject({ allowed: true, remaining: 1 - index })
    }
    await expect(consumeServiceRateLimit({ tx: getDb(), scope: 'test', subject: 'one', limit: 2, windowMs: 60_000, now })).resolves.toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 30 })
    await expect(consumeServiceRateLimit({ tx: getDb(), scope: 'test', subject: 'one', limit: 2, windowMs: 60_000, now: new Date(now.getTime() + 30_000) })).resolves.toMatchObject({ allowed: true, remaining: 1 })
  })

  it('isolates subjects and prevents concurrent callers from exceeding the limit', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeServiceRateLimit({ tx: getDb(), scope: 'concurrent', subject: 'one', limit: 3, windowMs: 60_000, now })))
    expect(results.filter((result) => result.allowed)).toHaveLength(3)
    await expect(consumeServiceRateLimit({ tx: getDb(), scope: 'concurrent', subject: 'two', limit: 3, windowMs: 60_000, now })).resolves.toMatchObject({ allowed: true, remaining: 2 })
  })

  it('publishes route dimensions including token sustained and burst limits', () => {
    expect(serviceRateLimits).toEqual({
      enrollmentInvitation: { limit: 10, windowMs: 60 * 60_000 },
      enrollmentIp: { limit: 30, windowMs: 60 * 60_000 },
      tokenCredential: { limit: 60, burst: 10, windowMs: 60_000 },
      ingestApp: { limit: 120, windowMs: 60_000 },
    })
    expect(tokenCredentialRequiredLimits('credential-1', now)).toEqual([
      { scope: 'token:credential:sustained', subject: 'credential-1', limit: 60, windowMs: 60_000, now },
      { scope: 'token:credential:burst', subject: 'credential-1', limit: 10, windowMs: 1_000, now },
    ])
  })

  it('enforces enrollment invitation, enrollment IP, token burst/sustained, and intake app dimensions behaviorally', async () => {
    await getDb().transaction(async (tx) => consumeRequiredLimits(tx, [
      { scope: 'enrollment:invitation', subject: 'digest-1', ...serviceRateLimits.enrollmentInvitation, now },
      { scope: 'enrollment:ip', subject: '203.0.113.1', ...serviceRateLimits.enrollmentIp, now },
    ]))
    await assertLimit('enrollment:invitation', 'digest-2', serviceRateLimits.enrollmentInvitation.limit, serviceRateLimits.enrollmentInvitation.windowMs)
    await assertLimit('enrollment:ip', '203.0.113.2', serviceRateLimits.enrollmentIp.limit, serviceRateLimits.enrollmentIp.windowMs)
    await assertLimit('token:credential:burst', 'credential-1', serviceRateLimits.tokenCredential.burst, 1_000)
    await assertLimit('token:credential:sustained', 'credential-1', serviceRateLimits.tokenCredential.limit, serviceRateLimits.tokenCredential.windowMs)
    await assertLimit('intake:app', 'app-1', serviceRateLimits.ingestApp.limit, serviceRateLimits.ingestApp.windowMs)
  })

  it('rolls back earlier dimensions when a required later dimension denies', async () => {
    await getDb().transaction(async (tx) => {
      await consumeServiceRateLimit({ tx, scope: 'ip', subject: '203.0.113.1', limit: 1, windowMs: 60_000, now })
    })
    await expect(getDb().transaction(async (tx) => consumeRequiredLimits(tx, [
      { scope: 'invitation', subject: 'digest', limit: 1, windowMs: 60_000, now },
      { scope: 'ip', subject: '203.0.113.1', limit: 1, windowMs: 60_000, now },
    ]))).rejects.toMatchObject({ name: 'ServiceRateLimitError', retryAfterSeconds: 30, scope: 'ip' })
    await expect(consumeServiceRateLimit({ tx: getDb(), scope: 'invitation', subject: 'digest', limit: 1, windowMs: 60_000, now })).resolves.toMatchObject({ allowed: true })
  })

  it('uses only the canonical deployment client IP header and ignores X-Forwarded-For', () => {
    expect(getTrustedClientIp(new Request('https://tower', { headers: { 'x-vercel-forwarded-for': '2001:db8::1', 'x-forwarded-for': '10.0.0.1' } }))).toBe('2001:db8::1')
    expect(getTrustedClientIp(new Request('https://tower', { headers: { 'x-vercel-forwarded-for': '2001:0DB8:0:0:0:0:0:1' } }))).toBe('2001:db8::1')
    expect(getTrustedClientIp(new Request('https://tower', { headers: { 'x-vercel-forwarded-for': '::FFFF:203.0.113.9' } }))).toBe('203.0.113.9')
    expect(getTrustedClientIp(new Request('https://tower', { headers: { 'x-forwarded-for': '203.0.113.8' } }))).toBeNull()
    expect(getTrustedClientIp(new Request('https://tower', { headers: { 'x-vercel-forwarded-for': '203.0.113.8, 198.51.100.2' } }))).toBeNull()
    expect(getTrustedClientIp(new Request('https://tower', { headers: { 'x-vercel-forwarded-for': 'not-an-ip' } }))).toBeNull()
    expect(getTrustedClientIp(new Request('https://tower'), { remoteAddress: '203.0.113.9' })).toBe('203.0.113.9')
  })
})

async function assertLimit(scope: string, subject: string, limit: number, windowMs: number): Promise<void> {
  await getDb().execute(sql`delete from service_rate_limit_buckets where scope = ${scope}`)
  for (let index = 0; index < limit; index += 1) {
    await expect(consumeServiceRateLimit({ tx: getDb(), scope, subject, limit, windowMs, now })).resolves.toMatchObject({ allowed: true })
  }
  await expect(consumeServiceRateLimit({ tx: getDb(), scope, subject, limit, windowMs, now })).resolves.toMatchObject({ allowed: false })
}
