import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { getDashboardData } from '@/lib/feedback/dashboard'

export const dynamic = 'force-dynamic'

export default async function AppsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const data = await getDashboardData()

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Connected applications</p>
          <h1>Source apps</h1>
          <p className="subtle">
            Apps appear here automatically when they send their first feedback
            payload to the ingest endpoint.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Environment</th>
                <th>Status</th>
                <th>Open tickets</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.apps.map((app) => (
                <tr key={app.id}>
                  <td>{app.name}</td>
                  <td>{app.slug}</td>
                  <td>{app.environment}</td>
                  <td>{app.status}</td>
                  <td>{app.openCount}</td>
                  <td>
                    {app.lastSeenAt
                      ? new Intl.DateTimeFormat('en', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(app.lastSeenAt)
                      : 'Never'}
                  </td>
                </tr>
              ))}
              {data.apps.length === 0 && (
                <tr>
                  <td colSpan={6} className="subtle">
                    No source app has checked in yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-body">
          <h2>Connector contract</h2>
          <p className="subtle">
            External apps should POST to `/api/feedback/ingest` with
            `Authorization: Bearer &lt;app-specific token&gt;`. Tokens are
            matched to `app.slug` through `SUPPORT_TOWER_INGEST_TOKENS_JSON`, so
            each source app can be rotated independently. The payload includes
            `app` identity and one `ticket`. `ticket.url` should be the deep
            link to the original app feedback dashboard; this tower mirrors
            status and links out, it does not replace the source app workflow.
          </p>
        </div>
      </div>
    </AppShell>
  )
}
