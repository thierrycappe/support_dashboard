import Link from 'next/link'
import type { Route } from 'next'
import AppShell from '@/components/AppShell'
import Badge from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import EmptyState from '@/components/ui/EmptyState'
import InlineNotice from '@/components/ui/InlineNotice'
import { requireAdminUser } from '@/lib/auth/guards'
import { hasDatabaseUrl } from '@/lib/db'
import { getAuditHistory, listCredentialSecurity } from '@/lib/audit/queries'

export const dynamic = 'force-dynamic'
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export default async function AccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminUser()
  const params = await searchParams
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined
  const configured = hasDatabaseUrl()
  const [audit, credentials] = configured ? await Promise.all([getAuditHistory({ cursor, limit: 50 }), listCredentialSecurity()]) : [{ rows: [], nextCursor: null }, []]
  return <AppShell><header className="topbar"><div><p className="eyebrow">Security administration</p><h1>Access</h1><p className="subtle">Portal roles, enrolled credential state, and attributable changes.</p></div><Link className="ui-button ui-button-primary" href={'/users' as Route}>Manage support users</Link></header>
    {!configured ? <InlineNotice tone="warning" title="Access data is temporarily unavailable">Configure the application data connection, then reload this view.</InlineNotice> : null}
    <section className="operations-section" aria-labelledby="credential-security-title"><div className="queue-heading"><h2 id="credential-security-title">Credential security</h2><span className="subtle">Public identifiers only</span></div><DataTable caption="Credential security" rows={credentials} getRowKey={(row) => row.id} emptyState={<EmptyState title="No application credentials" description="Credentials appear after an enrolled application completes key exchange." />} columns={[
      { key: 'appName', header: 'Application' }, { key: 'thumbprint', header: 'Public thumbprint', render: (row) => <code>{shortThumbprint(row.thumbprint)}</code> }, { key: 'status', header: 'State', render: (row) => <Badge tone={row.status === 'ACTIVE' ? 'success' : row.status === 'REVOKED' ? 'danger' : 'warning'}>{label(row.status)}</Badge> }, { key: 'validUntil', header: 'Valid until', render: (row) => row.validUntil ? date.format(row.validUntil) : 'No expiry' },
    ]} /></section>
    <section className="operations-section" aria-labelledby="audit-title"><div className="queue-heading"><h2 id="audit-title">Security audit</h2><span className="subtle">Newest changes first</span></div><DataTable caption="Security audit" rows={audit.rows} getRowKey={(row) => row.id} emptyState={<EmptyState title="No audit events" description="Administrative and connector changes appear here after they are recorded." />} columns={[
      { key: 'action', header: 'Action', render: (row) => label(row.action) }, { key: 'actorType', header: 'Actor', render: (row) => row.actorId ?? row.actorType }, { key: 'subjectType', header: 'Subject', render: (row) => row.subjectId ? `${row.subjectType}: ${row.subjectId}` : row.subjectType }, { key: 'reason', header: 'Reason', render: (row) => row.reason ?? 'No reason recorded' }, { key: 'createdAt', header: 'Recorded', render: (row) => <time dateTime={row.createdAt.toISOString()}>{date.format(row.createdAt)}</time> },
    ]} /></section>
    {audit.nextCursor ? <nav className="queue-pagination" aria-label="Audit pagination"><Link className="ui-page-step" href={`/access?cursor=${encodeURIComponent(audit.nextCursor)}` as Route}>Next page</Link></nav> : null}
  </AppShell>
}
function label(value: string): string { return value.split('_').map((part) => part.charAt(0) + part.slice(1).toLocaleLowerCase('en')).join(' ') }
function shortThumbprint(value: string): string { return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-10)}` : value }
