import Link from 'next/link'
import { Inbox, LayoutDashboard, RadioTower } from 'lucide-react'
import { logoutAction } from '@/app/login/actions'

export default function AppShell({ children }: { children: React.ReactNode }) {
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
