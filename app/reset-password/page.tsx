import Link from 'next/link'
import type { Route } from 'next'
import { isPasswordResetTokenValid } from '@/lib/auth/password-reset'
import { resetPasswordAction } from './actions'

const LOGIN_ROUTE = '/login' as Route
const FORGOT_PASSWORD_ROUTE = '/forgot-password' as Route

function errorMessage(error?: string): string | null {
  if (!error) return null
  if (error === 'mismatch') return 'The password confirmation did not match.'
  if (error === 'password_too_short') {
    return 'Choose a password with at least 12 characters.'
  }
  if (error === 'expired') return 'This reset link has expired.'
  return 'This reset link is no longer valid.'
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const params = await searchParams
  const token = params.token ?? ''
  const isValidToken = await isPasswordResetTokenValid(token)
  const message = errorMessage(params.error)

  return (
    <main className="content" style={{ maxWidth: 460, margin: '8vh auto' }}>
      <div className="panel">
        <div className="panel-body">
          <p className="eyebrow">Support Control Tower</p>
          <h1>Set password</h1>
          {!isValidToken ? (
            <div className="form">
              <div className="setup-box" role="alert">
                This reset link is invalid or expired.
              </div>
              <Link className="button" href={FORGOT_PASSWORD_ROUTE}>
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <p className="subtle">Choose a new password for your account.</p>
              {message && (
                <div className="setup-box" role="alert">
                  {message}
                </div>
              )}
              <form className="form" action={resetPasswordAction}>
                <input type="hidden" name="token" value={token} />
                <div className="field">
                  <label htmlFor="password">New password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <label htmlFor="confirmPassword">Confirm password</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="form-actions">
                  <button className="button" type="submit">
                    Save password
                  </button>
                  <Link className="button button-secondary" href={LOGIN_ROUTE}>
                    Back to sign in
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
