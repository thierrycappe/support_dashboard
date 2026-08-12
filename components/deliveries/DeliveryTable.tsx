'use client'

import { AlertTriangle, CircleAlert, RotateCw } from 'lucide-react'
import { useActionState } from 'react'
import Badge, { type BadgeTone } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import DataTable from '@/components/ui/DataTable'
import EmptyState from '@/components/ui/EmptyState'
import type { ActionState } from '@/app/deliveries/actions'
import type { DeliveryOperationsRow, DeliveryOperationsView } from '@/lib/delivery/queries'

const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
type RetryAction = (state: ActionState, formData: FormData) => Promise<ActionState>

export default function DeliveryTable({
  view, rows, deadLetterCount, routingIncidentCount, retryAction,
}: {
  view: DeliveryOperationsView; rows: DeliveryOperationsRow[]; deadLetterCount: number; routingIncidentCount: number; retryAction?: RetryAction
}) {
  return (
    <section className="operations-ledger" aria-labelledby="deliveries-table-title">
      <div className="operations-strip" aria-label="Delivery health">
        <StatusCount icon={<AlertTriangle data-testid="dead-letter-icon" aria-hidden="true" />} count={deadLetterCount} singular="dead letter" plural="dead letters" tone={deadLetterCount ? 'danger' : 'neutral'} />
        <StatusCount icon={<CircleAlert data-testid="routing-incident-icon" aria-hidden="true" />} count={routingIncidentCount} singular="routing incident" plural="routing incidents" tone={routingIncidentCount ? 'warning' : 'neutral'} />
      </div>
      <div className="queue-heading"><h2 id="deliveries-table-title">{viewLabel(view)}</h2><span className="subtle">{orderLabel(view)}</span></div>
      <DataTable
        caption="Delivery operations"
        rows={rows}
        getRowKey={(row) => row.id}
        emptyState={<DeliveryEmptyState view={view} />}
        columns={[
          { key: 'channelName', header: 'Channel', render: (row) => <div><strong>{row.channelName}</strong><span className="table-secondary">{row.destination}</span></div> },
          { key: 'status', header: 'State', render: (row) => <Badge tone={statusTone(row.status)}>{label(row.status)}</Badge> },
          { key: 'attemptCount', header: 'Attempts' },
          { key: 'nextAttemptAt', header: view === 'history' ? 'Recorded' : 'Next attempt', render: (row) => <time dateTime={(view === 'history' ? row.createdAt : row.nextAttemptAt)?.toISOString()}>{view === 'history' ? date.format(row.createdAt) : row.nextAttemptAt ? date.format(row.nextAttemptAt) : 'No scheduled retry'}</time> },
          { key: 'sanitizedCause', header: 'Delivery context', render: (row) => <DeliveryContext row={row} retryAction={retryAction} /> },
        ]}
      />
    </section>
  )
}

function DeliveryContext({ row, retryAction }: { row: DeliveryOperationsRow; retryAction?: RetryAction }) {
  const [state, action, pending] = useActionState(retryAction ?? unavailableRetry, { status: 'idle' } as ActionState)
  return <div className="delivery-context">
    {row.sanitizedCause ? <span>{row.sanitizedCause}</span> : <span className="subtle">No delivery issue recorded</span>}
    {row.routingIncident ? <span className="delivery-incident">{row.routingIncident}</span> : null}
    {row.retryAvailable && retryAction ? <form action={action}><input type="hidden" name="deliveryId" value={row.id} /><Button type="submit" variant="secondary" loading={pending}><RotateCw size={15} aria-hidden="true" />Retry delivery</Button>{state.status !== 'idle' ? <span className={state.status === 'error' ? 'field-error' : 'action-confirmation'} role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</span> : null}</form> : row.retryAvailable ? <span>Retry delivery</span> : null}
  </div>
}
async function unavailableRetry(): Promise<ActionState> { return { status: 'error', message: 'Delivery retry is unavailable' } }
function DeliveryEmptyState({ view }: { view: DeliveryOperationsView }) { const content: Record<DeliveryOperationsView, { title: string; description: string }> = { pending: { title: 'No deliveries are pending', description: 'Pending deliveries appear when an escalation needs a channel dispatch.' }, retrying: { title: 'No deliveries are retrying', description: 'Retrying deliveries appear after a temporary provider failure schedules another attempt.' }, failed: { title: 'No failed deliveries', description: 'Failed deliveries appear here when a channel needs operator attention.' }, history: { title: 'No delivery history', description: 'Sent, cancelled, and failed deliveries are retained here after dispatch.' } }; return <EmptyState {...content[view]} /> }
function StatusCount({ icon, count, singular, plural, tone }: { icon: React.ReactNode; count: number; singular: string; plural: string; tone: BadgeTone }) { return <span className="operation-status-count">{icon}<Badge tone={tone}>{count} {count === 1 ? singular : plural}</Badge></span> }
function label(value: string): string { return value.charAt(0) + value.slice(1).toLocaleLowerCase('en') }
function statusTone(status: DeliveryOperationsRow['status']): BadgeTone { return status === 'FAILED' ? 'danger' : status === 'RETRYING' || status === 'PENDING' || status === 'LEASED' ? 'warning' : status === 'SENT' ? 'success' : 'neutral' }
function viewLabel(view: DeliveryOperationsView): string { return ({ pending: 'Pending deliveries', retrying: 'Retrying deliveries', failed: 'Failed deliveries', history: 'Delivery history' })[view] }
function orderLabel(view: DeliveryOperationsView): string { return view === 'failed' || view === 'history' ? 'Newest first' : 'Next attempt first' }
