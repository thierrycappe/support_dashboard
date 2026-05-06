import { eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import AppShell from '@/components/AppShell'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets, sourceApps } from '@/lib/db/schema'
import { kindLabel, visibleStatusLabel } from '@/lib/feedback/status'

export const dynamic = 'force-dynamic'

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!hasDatabaseUrl()) {
    return (
      <AppShell>
        <div className="setup-box">Database not configured.</div>
      </AppShell>
    )
  }

  const { id } = await params
  const db = getDb()
  const rows = await db
    .select({
      ticket: feedbackTickets,
      appName: sourceApps.name,
      appSlug: sourceApps.slug,
    })
    .from(feedbackTickets)
    .innerJoin(sourceApps, eq(feedbackTickets.sourceAppId, sourceApps.id))
    .where(eq(feedbackTickets.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) notFound()

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">
            {row.appName} · {row.ticket.externalId}
          </p>
          <h1>{row.ticket.title}</h1>
          <p className="subtle">
            {kindLabel(row.ticket.kind)} · {visibleStatusLabel(row.ticket.status)}
          </p>
        </div>
      </div>

      <section className="grid two-column">
        <div className="panel">
          <div className="panel-body">
            <h2>Description</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{row.ticket.description}</p>
            {row.ticket.markdownSpec && (
              <>
                <h2>Specification</h2>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{row.ticket.markdownSpec}</pre>
              </>
            )}
          </div>
        </div>
        <aside className="panel">
          <div className="panel-body">
            <h2>Context</h2>
            <p>
              <strong>App:</strong> {row.appName} ({row.appSlug})
            </p>
            <p>
              <strong>Priority:</strong> {row.ticket.priority}
            </p>
            <p>
              <strong>Reporter:</strong>{' '}
              {row.ticket.reporterEmail ?? row.ticket.reporterName ?? 'Unknown'}
            </p>
            {row.ticket.url && (
              <p>
                <strong>URL:</strong> {row.ticket.url}
              </p>
            )}
          </div>
        </aside>
      </section>
    </AppShell>
  )
}
