import { z } from 'zod'
import { getAdminLoginRateLimit, recordAdminLoginAttempt } from './login-attempts'
import { verifyLegacyPlaintextPassword, verifyPassword } from './password'
import {
  ensureBootstrapSupportUser,
  getSupportUserByEmail,
  recordSupportUserLogin,
  type SupportUserRole,
} from './users'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1000),
})

export interface AdminUser {
  id: string
  email: string
  name: string
  role: SupportUserRole
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

function getBootstrapAdminPasswordHash(env: Env = process.env): string | null {
  return env.SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH?.trim() || null
}

export async function authorizeAdminCredentials(
  rawCredentials: unknown,
  request?: Request,
  env: Env = process.env,
): Promise<AdminUser | null> {
  const parsed = credentialsSchema.safeParse(rawCredentials)
  if (!parsed.success) return null

  const identifier = normalizeLoginIdentifier(parsed.data.email)
  const ipAddress = getRequestIp(request)
  const userAgent = request?.headers.get('user-agent') ?? null
  const rateLimit = await getAdminLoginRateLimit({ identifier, ipAddress })

  if (!rateLimit.allowed) {
    return null
  }

  const databaseUser = await getSupportUserByEmail(identifier)
  let user: AdminUser | null = null

  if (databaseUser?.status === 'ACTIVE') {
    const passwordMatches = await verifyPassword(
      parsed.data.password,
      databaseUser.passwordHash,
    )

    if (passwordMatches) {
      await recordSupportUserLogin(databaseUser.id)
      user = {
        id: databaseUser.id,
        email: databaseUser.email,
        name: databaseUser.name,
        role: databaseUser.role,
      }
    }
  }

  if (!user && !databaseUser) {
    const allowedEmails = getAllowedAdminEmails(env)
    const isAllowedEmail = allowedEmails.includes(identifier)
    const passwordMatches = await verifyAdminPassword(parsed.data.password, env)
    const passwordHash = getBootstrapAdminPasswordHash(env)

    if (isAllowedEmail && passwordMatches) {
      const bootstrapUser = passwordHash
        ? await ensureBootstrapSupportUser({
            email: identifier,
            name: 'Support Tower admin',
            passwordHash,
          })
        : null

      user = {
        id: bootstrapUser?.id ?? `admin:${identifier}`,
        email: identifier,
        name: bootstrapUser?.name ?? 'Support Tower admin',
        role: 'ADMIN',
      }
    }
  }

  const success = Boolean(user)

  await recordAdminLoginAttempt({
    identifier,
    ipAddress,
    userAgent,
    success,
  })

  return user
}
