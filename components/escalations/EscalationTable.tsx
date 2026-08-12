import Link from 'next/link'
import type { Route } from 'next'
import Badge, { type BadgeTone } from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import EmptyState from '@/components/ui/EmptyState'
import type { EscalationQueueRow } from '@/lib/escalations/queries'
import { kindLabel, visibleStatusLabel } from '@/lib/feedback/status'

const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export default function EscalationTable({ rows, nextHref, hasFilters }: { rows: EscalationQueueRow[]; nextHref: string | null; hasFilters: boolean }) {
  return (
    <section className="queue-ledger" aria-labelledby="queue-title">
      <div className="queue-heading"><h2 id="queue-title">Escalation queue</h2><span className="subtle">Newest updates first</span></div>
      <DataTable
        caption="Escalations queue" rows={rows} getRowKey={(row) => row.id}
        emptyState={hasFilters ? (
          <EmptyState title="No matching escalations" description="Change or clear the filters to review a wider queue." action={<Link href="/">Clear filters</Link>} />
        ) : (
          <EmptyState title="No escalations yet" description="Only feedback that was business-approved in an application appears here for technical follow-up." action={<Link href="/apps">Review applications</Link>} />
        )}
        columns={[
          { key: 'title', header: 'Escalation', render: (row) => <div className="queue-ticket"><Link href={`/feedback/${row.id}` as Route}>{row.title}</Link><span>{row.ownerApproval}</span></div> },
          { key: 'appName', header: 'Application', render: (row) => <div className="queue-application"><span>{row.appName}</span>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">Open source ticket</a> : <span className="subtle">Source link unavailable</span>}</div> },
          { key: 'kind', header: 'Classification', render: (row) => kindLabel(row.kind) },
          { key: 'priority', header: 'Priority', render: (row) => <Badge tone={row.priority === 'URGENT' ? 'warning' : 'neutral'}>{titleCase(row.priority)}</Badge> },
          { key: 'status', header: 'Status', render: (row) => visibleStatusLabel(row.status) },
          { key: 'deliveryStatus', header: 'Delivery', render: (row) => <Badge tone={deliveryTone(row.deliveryStatus)}>{deliveryLabel(row.deliveryStatus)}</Badge> },
          { key: 'updatedAt', header: 'Updated', render: (row) => <time dateTime={row.updatedAt.toISOString()}>{date.format(row.updatedAt)}</time> },
        ]}
      />
      <nav className="queue-pagination" aria-label="Queue pagination">
        {nextHref ? <Link className="ui-page-step" href={nextHref as Route} aria-label="Next queue page">Next page</Link> : <span className="ui-page-step" aria-disabled="true">Next page</span>}
      </nav>
    </section>
  )
}

function deliveryLabel(status: string): string {
  return ({ NOT_QUEUED: 'Not queued', PENDING: 'Pending', RETRYING: 'Retrying', FAILED: 'Failed', SENT: 'Sent' } as Record<string, string>)[status] ?? 'Pending'
}
function deliveryTone(status: string): BadgeTone { return status === 'FAILED' ? 'danger' : status === 'RETRYING' || status === 'PENDING' ? 'warning' : status === 'SENT' ? 'success' : 'neutral' }
function titleCase(value: string): string { return value.charAt(0) + value.slice(1).toLocaleLowerCase('en') }
