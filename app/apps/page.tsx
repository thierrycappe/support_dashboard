import Link from 'next/link'
import type { Route } from 'next'
import AppShell from '@/components/AppShell'
import Badge from '@/components/ui/Badge'
import DataTable from '@/components/ui/DataTable'
import EmptyState from '@/components/ui/EmptyState'
import InlineNotice from '@/components/ui/InlineNotice'
import { getApplications } from '@/lib/apps/queries'
import { hasDatabaseUrl } from '@/lib/db'
import { requireAdminUser } from '@/lib/auth/guards'

export const dynamic = 'force-dynamic'
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export default async function AppsPage() {
  await requireAdminUser()
  const configured = hasDatabaseUrl()
  const apps = configured ? await getApplications() : []
  return <AppShell><header className="topbar"><div><p className="eyebrow">Connector administration</p><h1>Applications</h1><p className="subtle">Ownership, enrollment, and notification readiness for connected applications.</p></div><Link className="ui-button ui-button-primary" href={'/apps/new' as Route}>Enroll application</Link></header>
    {!configured ? <InlineNotice tone="warning" title="Data is temporarily unavailable">Configure the application data connection, then reload this page.</InlineNotice> : null}
    <DataTable caption="Applications" rows={apps} getRowKey={(app) => app.id} emptyState={<EmptyState title="No applications yet" description="Applications appear after an administrator creates an enrollment invitation." action={<Link href={'/apps/new' as Route}>Enroll application</Link>} />} columns={[
      { key: 'name', header: 'Application', render: (app) => <div><Link href={`/apps/${app.id}` as Route}>{app.name}</Link><div className="subtle">{app.slug}</div></div> },
      { key: 'groupName', header: 'Technical group' }, { key: 'environment', header: 'Environment' },
      { key: 'enrollmentStatus', header: 'Enrollment', render: (app) => <Badge tone={app.enrollmentStatus === 'ACTIVE' ? 'success' : 'neutral'}>{label(app.enrollmentStatus)}</Badge> },
      { key: 'openCount', header: 'Open escalations' },
      { key: 'lastAuthenticatedAt', header: 'Last authenticated', render: (app) => app.lastAuthenticatedAt ? date.format(app.lastAuthenticatedAt) : 'Never' },
    ]} />
  </AppShell>
}

function label(value: string): string { return value.charAt(0) + value.slice(1).toLocaleLowerCase('en') }
