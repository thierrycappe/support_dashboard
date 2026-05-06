import { createHash, randomBytes } from 'node:crypto'
import { nanoid } from 'nanoid'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { passwordResetTokens } from '@/lib/db/schema'
import { getResendConfig, sendResendEmail } from '@/lib/email/resend'
import { getTowerPublicUrl } from '@/lib/notifications/pushover'
import { hashPassword } from './password'
import {
  getSupportUserByEmail,
  normalizeUserEmail,
  updateSupportUserPassword,
} from './users'

const RESET_TOKEN_BYTES = 32
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

type Env = Record<string, string | undefined>

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type PasswordResetRequestResult = 'sent' | 'disabled' | 'not_found' | 'failed'

export type PasswordResetConsumeResult =
  | 'success'
  | 'invalid'
  | 'expired'
  | 'password_too_short'

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getRequestIp(request?: Request): string | null {
  const forwardedFor = request?.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || null
  return request?.headers.get('x-real-ip')?.trim() || null
}

function getResetBaseUrl(env: Env): string | null {
  return getTowerPublicUrl(env)?.replace(/\/+$/, '') ?? null
}

export function buildPasswordResetEmail(input: {
  from: string
  to: string
  resetUrl: string
  userName: string
}) {
  return {
    from: input.from,
    to: [input.to],
    subject: 'Reset your Support Tower password',
    text: [
      `Hello ${input.userName},`,
      '',
      'Use this link to set a new Support Tower password:',
      input.resetUrl,
      '',
      'This link expires in 1 hour. If you did not request it, you can ignore this email.',
    ].join('\n'),
    html: [
      `<p>Hello ${input.userName},</p>`,
      '<p>Use this link to set a new Support Tower password:</p>',
      `<p><a href="${input.resetUrl}">Reset your password</a></p>`,
      '<p>This link expires in 1 hour. If you did not request it, you can ignore this email.</p>',
    ].join(''),
  }
}

export async function createPasswordResetToken(input: {
  userId: string
  request?: Request
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS)

  await getDb().insert(passwordResetTokens).values({
    id: nanoid(),
    userId: input.userId,
    tokenHash: hashResetToken(token),
    requestedIp: getRequestIp(input.request),
    userAgent: input.request?.headers.get('user-agent') ?? null,
    expiresAt,
    createdAt: now,
  })

  return { token, expiresAt }
}

export async function requestPasswordResetEmail({
  email,
  request,
  env = process.env,
  fetchImpl = fetch,
  logger = console,
}: {
  email: string
  request?: Request
  env?: Env
  fetchImpl?: FetchLike
  logger?: Pick<Console, 'warn'>
}): Promise<PasswordResetRequestResult> {
  if (!hasDatabaseUrl()) return 'disabled'

  const resend = getResendConfig(env)
  const baseUrl = getResetBaseUrl(env)
  if (!resend || !baseUrl) return 'disabled'

  const user = await getSupportUserByEmail(normalizeUserEmail(email))
  if (!user || user.status !== 'ACTIVE') return 'not_found'

  const { token } = await createPasswordResetToken({ userId: user.id, request })
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`
  const emailPayload = buildPasswordResetEmail({
    from: resend.from,
    to: user.email,
    resetUrl,
    userName: user.name,
  })

  try {
    const response = await sendResendEmail({
      config: resend,
      email: emailPayload,
      fetchImpl,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('Support tower password reset email failed', {
        status: response.status,
        body,
        userId: user.id,
      })
      return 'failed'
    }

    return 'sent'
  } catch (error) {
    logger.warn('Support tower password reset email failed', {
      error,
      userId: user.id,
    })
    return 'failed'
  }
}

export async function isPasswordResetTokenValid(token: string): Promise<boolean> {
  if (!token || !hasDatabaseUrl()) return false

  const rows = await getDb()
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashResetToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)

  return rows.length > 0
}

export async function consumePasswordResetToken(
  token: string,
  password: string,
): Promise<PasswordResetConsumeResult> {
  if (!token || !hasDatabaseUrl()) return 'invalid'
  if (password.length < 12) return 'password_too_short'

  const rows = await getDb()
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(token)))
    .limit(1)

  const resetToken = rows[0]
  if (!resetToken || resetToken.usedAt) return 'invalid'
  if (resetToken.expiresAt <= new Date()) return 'expired'

  await updateSupportUserPassword(resetToken.userId, await hashPassword(password))
  await getDb()
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, resetToken.id))

  return 'success'
}
