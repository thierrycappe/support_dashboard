import Link from 'next/link'
import Button from '@/components/ui/Button'
import type { EscalationQueueInput } from '@/lib/escalations/queries'

export default function EscalationFilters({ input, applications }: { input: EscalationQueueInput; applications: Array<{ id: string; name: string }> }) {
  return (
    <form className="queue-filters" method="get" action="/" aria-label="Filter escalations">
      <div className="field"><label htmlFor="queue-search">Search</label><input id="queue-search" name="search" type="search" defaultValue={input.search} placeholder="Title or source ID" /></div>
      <div className="field"><label htmlFor="queue-app">Application</label><select id="queue-app" name="app" defaultValue={input.appId ?? ''}><option value="">All applications</option>{applications.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></div>
      <div className="field"><label htmlFor="queue-priority">Priority</label><select id="queue-priority" name="priority" defaultValue={input.priority ?? ''}><option value="">All priorities</option>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="field"><label htmlFor="queue-status">Status</label><select id="queue-status" name="status" defaultValue={input.status ?? ''}><option value="">Open statuses</option>{['NEW', 'IN_REVIEW', 'BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FIXED', 'SHIPPED', 'DECLINED', 'CLOSED'].map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="queue-filter-actions"><Button type="submit">Apply filters</Button><Link className="ui-button ui-button-secondary" href="/">Clear filters</Link></div>
    </form>
  )
}
