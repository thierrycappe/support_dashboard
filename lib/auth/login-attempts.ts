import { nanoid } from 'nanoid'
import { and, count, eq, gte, or } from 'drizzle-orm'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { authLoginAttempts } from '@/lib/db/schema'

const MAX_FAILED_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

interface LoginAttemptKey {
  identifier: string
  ipAddress: string | null
}

interface RecordLoginAttemptInput extends LoginAttemptKey {
  userAgent: string | null
  success: boolean
}

export interface LoginRateLimit {
  allowed: boolean
  failedAttempts: number
  retryAfterSeconds: number | null
}

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_MS)
}

export async function getAdminLoginRateLimit({
  identifier,
  ipAddress,
}: LoginAttemptKey): Promise<LoginRateLimit> {
  if (!hasDatabaseUrl()) {
    return { allowed: true, failedAttempts: 0, retryAfterSeconds: null }
  }

  const actorCondition = ipAddress
    ? or(
        eq(authLoginAttempts.identifier, identifier),
        eq(authLoginAttempts.ipAddress, ipAddress),
      )
    : eq(authLoginAttempts.identifier, identifier)

  const conditions = [
    actorCondition,
    eq(authLoginAttempts.success, false),
    gte(authLoginAttempts.createdAt, windowStart()),
  ]

  const rows = await getDb()
    .select({ value: count() })
    .from(authLoginAttempts)
    .where(and(...conditions))

  const failedAttempts = rows[0]?.value ?? 0
  const allowed = failedAttempts < MAX_FAILED_ATTEMPTS

  return {
    allowed,
    failedAttempts,
    retryAfterSeconds: allowed ? null : Math.ceil(WINDOW_MS / 1000),
  }
}

export async function recordAdminLoginAttempt({
  identifier,
  ipAddress,
  userAgent,
  success,
}: RecordLoginAttemptInput): Promise<void> {
  if (!hasDatabaseUrl()) return

  await getDb().insert(authLoginAttempts).values({
    id: nanoid(),
    identifier,
    ipAddress,
    userAgent,
    success,
    createdAt: new Date(),
  })
}
