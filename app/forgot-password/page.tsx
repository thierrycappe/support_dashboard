import Link from 'next/link'
import type { Route } from 'next'
import { requestPasswordResetAction } from './actions'

const LOGIN_ROUTE = '/login' as Route

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>
}) {
  const params = await searchParams
  const sent = params.sent === '1'

  return (
    <main className="content" style={{ maxWidth: 460, margin: '8vh auto' }}>
      <div className="panel">
        <div className="panel-body">
          <p className="eyebrow">Support Control Tower</p>
          <h1>Reset password</h1>
          <p className="subtle">
            Enter your support account email and we will send a one-time reset link.
          </p>
          {sent && (
            <div className="setup-box" role="status">
              If this email belongs to an active support user, a reset link has
              been sent.
            </div>
          )}
          <form className="form" action={requestPasswordResetAction}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" />
            </div>
            <div className="form-actions">
              <button className="button" type="submit">
                Send reset link
              </button>
              <Link className="button button-secondary" href={LOGIN_ROUTE}>
                Back to sign in
              </Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
