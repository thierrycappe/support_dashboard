import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import AppShell from '@/components/AppShell'
import EscalationFilters from '@/components/escalations/EscalationFilters'
import EscalationTable from '@/components/escalations/EscalationTable'
import InlineNotice from '@/components/ui/InlineNotice'
import { hasDatabaseUrl } from '@/lib/db'
import { getEscalationApplications, getEscalationQueue } from '@/lib/escalations/queries'
import { buildEscalationQueueHref, parseEscalationSearchParams, type EscalationSearchParams } from '@/lib/escalations/search-params'

export const dynamic = 'force-dynamic'

export default async function EscalationsPage({ searchParams }: { searchParams: Promise<EscalationSearchParams> }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const input = parseEscalationSearchParams(await searchParams)
  const configured = hasDatabaseUrl()
  const [queue, applications] = configured
    ? await Promise.all([getEscalationQueue(input), getEscalationApplications()])
    : [{ summary: { open: 0, urgent: 0, newToday: 0, retrying: 0 }, rows: [], nextCursor: null }, []]
  const hasFilters = Boolean(input.search || input.appId || input.priority || input.status)

  return (
    <AppShell>
      <header className="topbar">
        <div><p className="eyebrow">Technical follow-up</p><h1>Escalations</h1><p className="subtle">Business-approved feedback awaiting technical action across applications.</p></div>
      </header>
      {!configured ? <InlineNotice tone="warning" title="Data is temporarily unavailable">Configure the application data connection, then reload this queue.</InlineNotice> : null}
      <dl className="summary-ledger" aria-label="Escalation summary">
        <div><dt>Open</dt><dd>{queue.summary.open.toLocaleString('en')}</dd></div>
        <div><dt>Urgent</dt><dd>{queue.summary.urgent.toLocaleString('en')}</dd></div>
        <div><dt>New today</dt><dd>{queue.summary.newToday.toLocaleString('en')}</dd></div>
        <div><dt>Retrying delivery</dt><dd>{queue.summary.retrying.toLocaleString('en')}</dd></div>
      </dl>
      <EscalationFilters input={input} applications={applications} />
      <EscalationTable rows={queue.rows} hasFilters={hasFilters} nextHref={queue.nextCursor ? buildEscalationQueueHref(input, queue.nextCursor) : null} />
    </AppShell>
  )
}
