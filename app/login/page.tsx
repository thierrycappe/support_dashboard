import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { loginAction } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await auth()
  if (session?.user) redirect('/')
  const params = await searchParams

  return (
    <main className="content" style={{ maxWidth: 460, margin: '8vh auto' }}>
      <div className="panel">
        <div className="panel-body">
          <p className="eyebrow">Support Control Tower</p>
          <h1>Sign in</h1>
          <p className="subtle">
            Use an authorized administrator account.
          </p>
          {params.error && (
            <div className="setup-box" role="alert">
              Sign-in failed. Check your email and password, or wait a few
              minutes if there were repeated failed attempts.
            </div>
          )}
          <form className="form" action={loginAction}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
              />
            </div>
            <button className="button" type="submit">
              Sign in
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
