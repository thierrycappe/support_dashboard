import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { auth } from '@/auth'
import InlineNotice from '@/components/ui/InlineNotice'
import { getActivityKpisData } from '@/lib/feedback/activity'

export const dynamic = 'force-dynamic'

export default async function InsightsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const data = await getActivityKpisData()

  return (
    <AppShell>
      <header className="topbar">
        <div><p className="eyebrow">Historical activity</p><h1>Insights</h1><p className="subtle">Resolution throughput and workflow timing across the last eight weeks.</p></div>
        <span className="ui-badge ui-badge-neutral">{data.periodLabel}</span>
      </header>
      {!data.databaseConfigured ? <InlineNotice tone="warning" title="Data is temporarily unavailable">Configure the application data connection, then reload this view.</InlineNotice> : null}
      <section className="insights-ledger" aria-labelledby="insights-summary-title">
        <div className="queue-heading"><h2 id="insights-summary-title">Resolution summary</h2><span className="subtle">Compared with the preceding eight weeks</span></div>
        <dl>
          <div><dt>Resolved bugs</dt><dd>{data.summary.resolvedBugs}</dd><span>{data.summary.resolvedDelta}</span></div>
          <div><dt>Median cycle</dt><dd>{data.summary.medianCycle}</dd><span>{data.summary.medianCycleDelta}</span></div>
          <div><dt>Requester wait</dt><dd>{data.summary.requesterWait}</dd><span>{data.summary.requesterWaitDelta}</span></div>
          <div><dt>Created and resolved</dt><dd>{data.summary.createdResolved}</dd><span>{data.summary.createdResolvedDelta}</span></div>
        </dl>
      </section>
      <section className="insights-notes" aria-labelledby="workflow-time-title">
        <h2 id="workflow-time-title">Workflow time</h2>
        {data.statusTimes.length ? <ul>{data.statusTimes.map((item) => <li key={item.label}><span>{item.label}</span><strong>{item.time}</strong></li>)}</ul> : <p className="subtle">Workflow timing appears after business-approved bugs begin technical follow-up.</p>}
      </section>
    </AppShell>
  )
}
