import { cookies } from 'next/headers'
import { logoutAction } from '@/app/login/actions'
import { auth } from '@/auth'
import NavLinks from '@/components/NavLinks'
import ThemeToggle from '@/components/ThemeToggle'
import { normalizeTheme } from '@/components/theme'
import { hasDatabaseUrl } from '@/lib/db'
import { getDeadLetterCount } from '@/lib/delivery/queries'

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore, deadLetterCount] = await Promise.all([
    auth(), cookies(), hasDatabaseUrl() ? getDeadLetterCount().catch(() => 0) : Promise.resolve(0),
  ])
  const isAdmin = session?.user?.role === 'ADMIN'
  const theme = normalizeTheme(cookieStore.get('support-theme')?.value)
  const identity = session?.user?.name ?? session?.user?.email ?? (isAdmin ? 'Administrator' : 'Support operator')

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar" aria-label="Support Tower">
        <div className="brand" aria-label="Support Tower home">
          <span className="brand-mark" aria-hidden="true">ST</span>
          <span>Support Tower</span>
        </div>
        <NavLinks isAdmin={isAdmin} deadLetterCount={deadLetterCount} />
        <div className="shell-utilities">
          <ThemeToggle initialTheme={theme} />
          <div className="operator-identity">
            <span>{identity}</span>
            <span className="operator-role">{isAdmin ? 'Admin' : 'Support'}</span>
          </div>
          <form action={logoutAction}>
            <button className="button button-secondary shell-signout" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="content" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  )
}
