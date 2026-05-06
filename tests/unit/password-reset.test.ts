import { describe, expect, it, vi } from 'vitest'
import { buildPasswordResetEmail } from '@/lib/auth/password-reset'
import { getResendConfig, sendResendEmail } from '@/lib/email/resend'

describe('password reset email', () => {
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
})
