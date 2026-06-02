import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { getDashboardData } from '@/lib/feedback/dashboard'
import {
  isStaleTicket,
  kindLabel,
  visibleStatusLabel,
  type FeedbackKind,
  type FeedbackStatus,
} from '@/lib/feedback/status'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const data = await getDashboardData()

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Open feedback across apps</p>
          <h1>Control tower</h1>
          <p className="subtle">
            Centralize bug reports and evolutions created by the feedback loops in
            your applications.
          </p>
        </div>
      </div>

      {!data.databaseConfigured && (
        <div className="setup-box">
          <strong>Database not configured.</strong> Add `DATABASE_URL` to
          `.env.local`, run `npm run db:push`, then refresh this page.
        </div>
      )}

      <section className="grid stats-grid" style={{ marginTop: 18 }}>
        <div className="panel stat">
          <div className="stat-value">{data.totals.open}</div>
          <div className="stat-label">Open tickets</div>
        </div>
        <div className="panel stat">
          <div className="stat-value">{data.totals.bugs}</div>
          <div className="stat-label">Bugs</div>
        </div>
        <div className="panel stat">
          <div className="stat-value">{data.totals.evolutions}</div>
          <div className="stat-label">Evolutions</div>
        </div>
        <div className="panel stat">
          <div className="stat-value">{data.totals.urgent}</div>
          <div className="stat-label">Urgent</div>
        </div>
      </section>

      <section className="grid two-column" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-header">
            <h2>Open queue</h2>
          </div>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>App</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      {ticket.url ? (
                        <a href={ticket.url} target="_blank" rel="noreferrer">
                          {ticket.title}
                          <ExternalLink
                            size={14}
                            aria-label="Open original feedback dashboard"
                            style={{ marginLeft: 6, verticalAlign: '-2px' }}
                          />
                        </a>
                      ) : (
                        <Link href={`/feedback/${ticket.id}`}>{ticket.title}</Link>
                      )}
                      <div className="subtle">{ticket.reporterEmail ?? ticket.externalId}</div>
                    </td>
                    <td>{ticket.appName}</td>
                    <td>
                      <span
                        className={`badge ${
                          ticket.kind === 'BUG' ? 'badge-bug' : 'badge-evolution'
                        }`}
                      >
                        {kindLabel(ticket.kind as FeedbackKind)}
                      </span>
                    </td>
                    <td>
                      {visibleStatusLabel(ticket.status as FeedbackStatus)}
                      {isStaleTicket({
                        status: ticket.status as FeedbackStatus,
                        lastSyncedAt: ticket.lastSyncedAt,
                      }) && (
                        <span
                          className="badge badge-stale"
                          title={`No update from source app since ${ticket.lastSyncedAt?.toISOString()}`}
                          style={{ marginLeft: 6 }}
                        >
                          Stale sync
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          ticket.priority === 'URGENT' ? 'badge-urgent' : ''
                        }`}
                      >
                        {ticket.priority}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.tickets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="subtle">
                      No open tickets have been synced yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Source apps</h2>
          </div>
          <div className="panel-body">
            <table className="table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {data.apps.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <strong>{app.name}</strong>
                      <div className="subtle">{app.slug}</div>
                    </td>
                    <td>{app.openCount}</td>
                  </tr>
                ))}
                {data.apps.length === 0 && (
                  <tr>
                    <td colSpan={2} className="subtle">
                      No source app has checked in yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AppShell>
  )
}
