import Link from 'next/link'
import type { Route } from 'next'
import AppShell from '@/components/AppShell'
import DeliveryTable from '@/components/deliveries/DeliveryTable'
import { retryDeliveryAction } from '@/app/deliveries/actions'
import { requireDeliveryRetryUser } from '@/lib/auth/guards'
import { hasDatabaseUrl } from '@/lib/db'
import { getDeliveryOperations, type DeliveryOperationsView } from '@/lib/delivery/queries'
import InlineNotice from '@/components/ui/InlineNotice'

export const dynamic = 'force-dynamic'
const views: DeliveryOperationsView[] = ['pending', 'retrying', 'failed', 'history']

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireDeliveryRetryUser()
  const params = await searchParams
  const view = scalar(params.view) as DeliveryOperationsView
  const selected = views.includes(view) ? view : 'pending'
  const cursor = scalar(params.cursor)
  const configured = hasDatabaseUrl()
  const operations = configured ? await getDeliveryOperations({ view: selected, cursor, limit: 50 }) : { rows: [], summary: { deadLetters: 0, routingIncidents: 0, unhealthyChannels: 0 }, nextCursor: null }
  return <AppShell><header className="topbar"><div><p className="eyebrow">Delivery operations</p><h1>Deliveries</h1><p className="subtle">Dispatch state, provider recovery, and routing readiness.</p></div></header>
    <nav className="operations-tabs" aria-label="Delivery views">{views.map((item) => <Link key={item} href={`/deliveries?view=${item}` as Route} aria-current={item === selected ? 'page' : undefined}>{label(item)}</Link>)}</nav>
    {!configured ? <InlineNotice tone="warning" title="Delivery data is temporarily unavailable">Configure the application data connection, then reload this view.</InlineNotice> : null}
    <div className="operations-strip"><span>{operations.summary.unhealthyChannels} unhealthy {operations.summary.unhealthyChannels === 1 ? 'channel' : 'channels'}</span></div>
    <DeliveryTable view={selected} rows={operations.rows} deadLetterCount={operations.summary.deadLetters} routingIncidentCount={operations.summary.routingIncidents} retryAction={retryDeliveryAction} />
    {operations.nextCursor ? <nav className="queue-pagination" aria-label="Delivery pagination"><Link className="ui-page-step" href={`/deliveries?view=${selected}&cursor=${encodeURIComponent(operations.nextCursor)}` as Route}>Next page</Link></nav> : null}
  </AppShell>
}
function scalar(value: string | string[] | undefined): string { return typeof value === 'string' ? value : '' }
function label(value: string): string { return value.charAt(0) + value.slice(1).toLocaleLowerCase('en') }
