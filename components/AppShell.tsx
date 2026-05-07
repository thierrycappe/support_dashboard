import Link from 'next/link'
import type { Route } from 'next'
import { ChartNoAxesColumnIncreasing, Inbox, LayoutDashboard, RadioTower, Users } from 'lucide-react'
import { logoutAction } from '@/app/login/actions'
import { auth } from '@/auth'

const USERS_ROUTE = '/users' as Route
const ACTIVITY_KPIS_ROUTE = '/activity-kpis' as Route

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const isAdmin = session?.user?.role === 'ADMIN'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <RadioTower size={18} aria-hidden="true" />
          </span>
          <span>Support Tower</span>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          <Link className="nav-link" href="/">
            <LayoutDashboard size={18} aria-hidden="true" />
            Dashboard
          </Link>
          <Link className="nav-link" href="/apps">
            <Inbox size={18} aria-hidden="true" />
            Source apps
          </Link>
          <Link className="nav-link" href={ACTIVITY_KPIS_ROUTE}>
            <ChartNoAxesColumnIncreasing size={18} aria-hidden="true" />
            Activity KPIs
          </Link>
          {isAdmin && (
            <Link className="nav-link" href={USERS_ROUTE}>
              <Users size={18} aria-hidden="true" />
              Users
            </Link>
          )}
        </nav>
        <form action={logoutAction} style={{ marginTop: 24 }}>
          <button className="button button-secondary" type="submit">
            Sign out
          </button>
        </form>
      </aside>
      <main className="content">{children}</main>
    </div>
  )
}
