import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { sql } from 'drizzle-orm'
import { getDb, type Db, type DbTransaction } from '@/lib/db'

export const serviceRateLimits = {
  enrollmentInvitation: { limit: 10, windowMs: 60 * 60_000 },
  enrollmentIp: { limit: 30, windowMs: 60 * 60_000 },
  tokenCredential: { limit: 60, burst: 10, windowMs: 60_000 },
  ingestApp: { limit: 120, windowMs: 60_000 },
} as const

/**
 * The longest service-rate-limit window is one hour. Retaining buckets for a
 * further hour keeps every active window available while maintenance scans old
 * rows outside the authentication transaction.
 */
export const RATE_LIMIT_BUCKET_RETENTION_MS = 2 * 60 * 60_000
const DEFAULT_RATE_LIMIT_CLEANUP_LIMIT = 100

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export interface RequiredRateLimit {
  scope: string
  subject: string
  limit: number
  windowMs: number
  now?: Date
}

export class ServiceRateLimitError extends Error {
  constructor(
    readonly decision: RateLimitDecision,
    readonly scope: string,
  ) {
    super('Service rate limit exceeded')
    this.name = 'ServiceRateLimitError'
  }

  get retryAfterSeconds(): number {
    return this.decision.retryAfterSeconds
  }
}

export function tokenCredentialRequiredLimits(credentialId: string, now = new Date()): RequiredRateLimit[] {
  return [
    { scope: 'token:credential:sustained', subject: credentialId, limit: serviceRateLimits.tokenCredential.limit, windowMs: serviceRateLimits.tokenCredential.windowMs, now },
    { scope: 'token:credential:burst', subject: credentialId, limit: serviceRateLimits.tokenCredential.burst, windowMs: 1_000, now },
  ]
}

type RateLimitExecutor = Db | DbTransaction

export async function consumeServiceRateLimit({
  tx = getDb(),
  scope,
  subject,
  limit,
  windowMs,
  now = new Date(),
  bucketId = randomUUID(),
}: RequiredRateLimit & { tx?: RateLimitExecutor; bucketId?: string }): Promise<RateLimitDecision> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1 || !scope || !subject || !bucketId) {
    throw new Error('Invalid service rate limit')
  }
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const result = await tx.execute<{ count: number } & Record<string, unknown>>(sql`
    insert into service_rate_limit_buckets (id, scope, subject, window_start, count, created_at, updated_at)
      values (${bucketId}, ${scope}, ${subject}, ${windowStart}, 1, ${now}, ${now})
    on conflict (scope, subject, window_start)
      do update set count = service_rate_limit_buckets.count + 1, updated_at = ${now}
    returning count
  `)
  const count = result.rows[0]!.count
  const allowed = count <= limit
  return {
    allowed,
    remaining: Math.max(limit - count, 0),
    retryAfterSeconds: allowed ? 0 : Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1_000),
  }
}

export async function consumeRequiredLimits(tx: DbTransaction, limits: RequiredRateLimit[]): Promise<void> {
  for (const limit of limits) {
    const decision = await consumeServiceRateLimit({ tx, ...limit })
    if (!decision.allowed) throw new ServiceRateLimitError(decision, limit.scope)
  }
}

/**
 * Deletes one bounded batch of buckets whose complete retention period has
 * elapsed. The strict comparison preserves a bucket exactly at the boundary.
 * This maintenance-only operation is deliberately separate from request
 * authentication, so cleanup failure cannot deny a valid request.
 */
export async function cleanupExpiredServiceRateLimitBuckets({
  db = getDb(),
  now = new Date(),
  limit = DEFAULT_RATE_LIMIT_CLEANUP_LIMIT,
  statementTimeoutMs,
}: {
  db?: Db
  now?: Date
  limit?: number
  statementTimeoutMs?: number
} = {}): Promise<number> {
  const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : DEFAULT_RATE_LIMIT_CLEANUP_LIMIT
  const threshold = new Date(now.getTime() - RATE_LIMIT_BUCKET_RETENTION_MS)
  if (statementTimeoutMs === undefined) return deleteExpiredServiceRateLimitBuckets(db, threshold, boundedLimit)

  const boundedTimeoutMs = Math.min(Math.max(Math.floor(statementTimeoutMs), 1), 60_000)
  const deadline = Date.now() + boundedTimeoutMs
  return db.transaction(async (tx) => {
    const remainingMs = Math.max(deadline - Date.now(), 1)
    await tx.execute(sql`select set_config('statement_timeout', ${`${remainingMs}ms`}, true)`)
    return deleteExpiredServiceRateLimitBuckets(tx, threshold, boundedLimit)
  })
}

async function deleteExpiredServiceRateLimitBuckets(
  db: Db | DbTransaction,
  threshold: Date,
  limit: number,
): Promise<number> {
  const deleted = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    with candidates as (
      select id
        from service_rate_limit_buckets
       where window_start < ${threshold}
       order by window_start, id
       limit ${limit}
       for update skip locked
    )
    delete from service_rate_limit_buckets bucket
     using candidates
     where bucket.id = candidates.id
     returning bucket.id
  `)
  return deleted.rows.length
}

export function getTrustedClientIp(
  request: Request,
  { remoteAddress }: { remoteAddress?: string | null } = {},
): string | null {
  const candidate = remoteAddress ?? request.headers.get('x-vercel-forwarded-for')
  if (!candidate || candidate.includes(',')) return null
  const address = candidate.trim()
  if (!address || isIP(address) === 0) return null
  return canonicalIp(address)
}

function canonicalIp(address: string): string {
  if (isIP(address) === 4) return address
  const groups = expandIpv6(address)
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`
  }
  let bestStart = -1
  let bestLength = 0
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) { index += 1; continue }
    const start = index
    while (groups[index] === 0) index += 1
    if (index - start > bestLength && index - start >= 2) {
      bestStart = start
      bestLength = index - start
    }
  }
  const tokens = groups.map((group) => group.toString(16))
  if (bestStart === -1) return tokens.join(':')
  const before = tokens.slice(0, bestStart).join(':')
  const after = tokens.slice(bestStart + bestLength).join(':')
  return before && after ? `${before}::${after}` : before ? `${before}::` : `::${after}`
}

function expandIpv6(address: string): number[] {
  const [left = '', right = ''] = address.toLowerCase().split('::')
  const leftTokens = ipv6Tokens(left ? left.split(':') : [])
  const rightTokens = ipv6Tokens(right ? right.split(':') : [])
  const tokens = [...leftTokens, ...rightTokens]
  const missing = 8 - tokens.length
  const groups = address.includes('::')
    ? [...leftTokens, ...Array.from({ length: missing }, () => '0'), ...rightTokens]
    : tokens
  return groups.map((token) => Number.parseInt(token, 16))
}

function ipv6Tokens(tokens: string[]): string[] {
  const dottedIndex = tokens.findIndex((token) => token.includes('.'))
  if (dottedIndex < 0) return tokens
  const dotted = tokens[dottedIndex]!.split('.').map(Number)
  return [
    ...tokens.slice(0, dottedIndex),
    ((dotted[0]! << 8) | dotted[1]!).toString(16),
    ((dotted[2]! << 8) | dotted[3]!).toString(16),
    ...tokens.slice(dottedIndex + 1),
  ]
}
