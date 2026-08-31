import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  hasDatabaseUrl: vi.fn(),
  getSupportUserByEmail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
  hasDatabaseUrl: mocks.hasDatabaseUrl,
}))

vi.mock('@/lib/auth/users', () => ({
  getSupportUserByEmail: mocks.getSupportUserByEmail,
  normalizeUserEmail: (email: string) => email.trim().toLowerCase(),
  updateSupportUserPassword: vi.fn(),
}))

import {
  buildPasswordResetEmail,
  requestPasswordResetEmail,
} from '@/lib/auth/password-reset'
import { getResendConfig, sendResendEmail } from '@/lib/email/resend'

describe('password reset email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasDatabaseUrl.mockReturnValue(true)
    mocks.getSupportUserByEmail.mockResolvedValue({
      id: 'user-private-id',
      email: 'thierry.cappe@manutan.fr',
      name: 'Thierry',
      status: 'ACTIVE',
    })
    mocks.getDb.mockReturnValue({
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    })
  })

  it('builds a one-time reset email', () => {
    const email = buildPasswordResetEmail({
      from: 'Support Tower <support@example.com>',
      to: 'thierry.cappe@manutan.fr',
      resetUrl: 'https://support.example.com/reset-password?token=test',
      userName: 'Thierry',
    })

    expect(email.from).toBe('Support Tower <support@example.com>')
    expect(email.to).toEqual(['thierry.cappe@manutan.fr'])
    expect(email.subject).toBe('Reset your Support Tower password')
    expect(email.text).toContain(
      'https://support.example.com/reset-password?token=test',
    )
    expect(email.html).toContain('Reset your password')
  })

  it('resolves Resend config from env vars', () => {
    expect(
      getResendConfig({
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'Support Tower <support@example.com>',
      }),
    ).toEqual({
      apiKey: 're_test',
      from: 'Support Tower <support@example.com>',
    })
  })

  it('sends email through the Resend API', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init
      return new Response('{}', { status: 200 })
    })

    await sendResendEmail({
      config: {
        apiKey: 're_test',
        from: 'Support Tower <support@example.com>',
      },
      email: {
        from: 'Support Tower <support@example.com>',
        to: ['thierry.cappe@manutan.fr'],
        subject: 'Reset your Support Tower password',
        text: 'Reset link',
        html: '<p>Reset link</p>',
      },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(requestInit?.headers).toEqual({
      Authorization: 'Bearer re_test',
      'Content-Type': 'application/json',
    })
  })

  it('logs only a fixed status envelope when Resend rejects a reset email', async () => {
    const logger = { warn: vi.fn() }
    const providerBody = JSON.stringify({
      message: 'recipient thierry.cappe@manutan.fr rejected',
      resetUrl: 'https://support.example.com/reset-password?token=private',
    })

    const result = await requestPasswordResetEmail({
      email: 'thierry.cappe@manutan.fr',
      env: {
        DATABASE_URL: 'postgresql://unused',
        RESEND_API_KEY: 're_private-key',
        RESEND_FROM: 'Support Tower <support@example.com>',
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
      fetchImpl: vi.fn(async () =>
        new Response(providerBody, {
          status: 429,
          headers: { 'x-request-id': 'req_reset_456' },
        }),
      ),
      logger,
    })

    expect(result).toBe('failed')
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Support tower password reset email failed',
      {
        failureClass: 'PROVIDER_REJECTED',
        status: 429,
        requestId: 'req_reset_456',
      },
    )
    const serializedLog = JSON.stringify(logger.warn.mock.calls)
    expect(serializedLog).not.toContain('thierry.cappe@manutan.fr')
    expect(serializedLog).not.toContain('reset-password')
    expect(serializedLog).not.toContain('user-private-id')
    expect(serializedLog).not.toContain('re_private-key')
  })

  it('logs only a fixed transport envelope when reset dispatch throws', async () => {
    const logger = { warn: vi.fn() }

    const result = await requestPasswordResetEmail({
      email: 'thierry.cappe@manutan.fr',
      env: {
        DATABASE_URL: 'postgresql://unused',
        RESEND_API_KEY: 're_private-key',
        RESEND_FROM: 'Support Tower <support@example.com>',
        SUPPORT_TOWER_PUBLIC_URL: 'https://support.example.com',
      },
      fetchImpl: vi.fn(async () => {
        throw new Error(
          'connect ECONNREFUSED smtp-internal.example with re_private-key',
        )
      }),
      logger,
    })

    expect(result).toBe('failed')
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Support tower password reset email failed',
      {
        failureClass: 'TRANSPORT_FAILURE',
        status: null,
        requestId: null,
      },
    )
    const serializedLog = JSON.stringify(logger.warn.mock.calls)
    expect(serializedLog).not.toContain('ECONNREFUSED')
    expect(serializedLog).not.toContain('smtp-internal')
    expect(serializedLog).not.toContain('user-private-id')
    expect(serializedLog).not.toContain('re_private-key')
  })
})
