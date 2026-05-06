import { z } from 'zod'
import { getAdminLoginRateLimit, recordAdminLoginAttempt } from './login-attempts'
import { verifyLegacyPlaintextPassword, verifyPassword } from './password'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1000),
})

export interface AdminUser {
  id: string
  email: string
  name: string
}

type Env = Record<string, string | undefined>

export function getAllowedAdminEmails(env: Env = process.env): string[] {
  const configured =
    env.SUPPORT_DASHBOARD_ADMIN_EMAILS || env.SUPPORT_DASHBOARD_ADMIN_EMAIL || ''

  return configured
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function normalizeLoginIdentifier(email: string): string {
  return email.trim().toLowerCase()
}

export function getRequestIp(request?: Request): string | null {
  const forwardedFor = request?.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || null

  return request?.headers.get('x-real-ip')?.trim() || null
}

export async function verifyAdminPassword(
  password: string,
  env: Env = process.env,
): Promise<boolean> {
  const passwordHash = env.SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH?.trim()
  if (passwordHash) return verifyPassword(password, passwordHash)

  const legacyPassword = env.SUPPORT_DASHBOARD_ADMIN_PASSWORD
  if (legacyPassword && env.NODE_ENV !== 'production') {
    return verifyLegacyPlaintextPassword(password, legacyPassword)
  }

  return false
}

export async function authorizeAdminCredentials(
  rawCredentials: unknown,
  request?: Request,
  env: Env = process.env,
): Promise<AdminUser | null> {
  const parsed = credentialsSchema.safeParse(rawCredentials)
  if (!parsed.success) return null

  const identifier = normalizeLoginIdentifier(parsed.data.email)
  const allowedEmails = getAllowedAdminEmails(env)
  const isAllowedEmail = allowedEmails.includes(identifier)
  const ipAddress = getRequestIp(request)
  const userAgent = request?.headers.get('user-agent') ?? null
  const rateLimit = await getAdminLoginRateLimit({ identifier, ipAddress })

  if (!rateLimit.allowed) {
    return null
  }

  const passwordMatches = await verifyAdminPassword(parsed.data.password, env)
  const success = isAllowedEmail && passwordMatches

  await recordAdminLoginAttempt({
    identifier,
    ipAddress,
    userAgent,
    success,
  })

  if (!success) return null

  return {
    id: `admin:${identifier}`,
    email: identifier,
    name: 'Support Tower admin',
  }
}
