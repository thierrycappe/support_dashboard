import { notFound } from 'next/navigation'
import AppShell from '@/components/AppShell'
import Badge from '@/components/ui/Badge'
import CredentialLifecycle from '@/components/apps/CredentialLifecycle'
import { beginAdminRotationAction, revokeAppCredentialAction } from '@/app/apps/actions'
import { getApplicationCredentialInventory, getApplicationDetail } from '@/lib/apps/queries'
import { getConnectorStatus } from '@/lib/feedback/connector-status'
import { requireAdminUser } from '@/lib/auth/guards'

export const dynamic = 'force-dynamic'
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminUser()
  const id = (await params).id
  const [app, credentials] = await Promise.all([
    getApplicationDetail(id),
    getApplicationCredentialInventory(id),
  ])
  if (!app) notFound()
  // Bearer apps authenticate from env vars, so enrollment can read ACTIVE while
  // the connector is still dead. Public-key apps use app_credentials instead.
  const wiring = app.credentialMode === 'LEGACY_BEARER' ? getConnectorStatus(app.slug) : null
  return <AppShell><header className="topbar"><div><p className="eyebrow">Application</p><h1>{app.name}</h1><p className="subtle">Ownership, connector status, and current notification policy.</p></div><Badge tone={app.enrollmentStatus === 'ACTIVE' ? 'success' : 'neutral'}>{label(app.enrollmentStatus)}</Badge></header>
    <section className="panel" aria-labelledby="identity-title"><div className="panel-body"><h2 id="identity-title">Identity</h2><dl><div><dt>Stable slug</dt><dd><code>{app.slug}</code> <span className="subtle">Locked after enrollment</span></dd></div><div><dt>Environment</dt><dd>{app.environment}</dd></div><div><dt>Application URL</dt><dd>{app.baseUrl ?? 'Not recorded'}</dd></div><div><dt>Credential mode</dt><dd>{label(app.credentialMode)}</dd></div></dl></div></section>
    <section aria-labelledby="owners-title"><h2 id="owners-title">Owners</h2><p>{app.groupName}</p><ul>{app.owners.map((owner) => <li key={owner.id}>{owner.name} <span className="subtle">{owner.email}</span></li>)}</ul></section>
    <section aria-labelledby="alerts-title"><h2 id="alerts-title">Notification policy</h2><dl><div><dt>Minimum priority</dt><dd>{app.minimumPriority ?? 'Not configured'}</dd></div><div><dt>Urgent central copy</dt><dd>{app.urgentCentralCopy ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Central fallback</dt><dd>{app.fallbackToCentral ? 'Enabled' : 'Disabled'}</dd></div></dl></section>
    <section aria-labelledby="invitation-title"><h2 id="invitation-title">Invitation</h2>{app.invitation ? <dl><div><dt>Prefix</dt><dd><code>{app.invitation.prefix}</code></dd></div><div><dt>Status</dt><dd>{label(app.invitation.status)}</dd></div><div><dt>Expires</dt><dd>{date.format(app.invitation.expiresAt)}</dd></div>{app.invitation.consumedAt ? <div><dt>Consumed</dt><dd>{date.format(app.invitation.consumedAt)}</dd></div> : null}</dl> : <p className="subtle">No invitation metadata is available. Invitation secrets are never stored.</p>}</section>
    {wiring ? <section className="panel" aria-labelledby="wiring-title"><div className="panel-body"><h2 id="wiring-title">Connector wiring</h2><p className="subtle">Read from this deployment&rsquo;s environment, not the database. Env vars only apply after the tower is redeployed.</p><dl>
      <div><dt>Inbound token</dt><dd><Badge tone={wiring.ingestConfigured ? 'success' : 'danger'}>{wiring.ingestConfigured ? 'Configured' : 'Missing'}</Badge> <code>{wiring.ingestEnvVar}</code>{wiring.ingestConfigured ? null : <span className="subtle"> Pushes from this app return 401 until this is set.</span>}</dd></div>
      <div><dt>Pull sync</dt><dd><Badge tone={wiring.pullConfigured ? 'success' : 'warning'}>{wiring.pullConfigured ? 'Configured' : 'Not configured'}</Badge> {wiring.pullConfigured ? <code>{wiring.pullUrl}</code> : <span className="subtle">Add this slug to SUPPORT_TOWER_SOURCE_APP_PULL_JSON, or tickets go stale after 48h.</span>}</dd></div>
      {wiring.slugRoundTrips ? null : <div><dt>Slug</dt><dd><Badge tone="danger">Unresolvable</Badge> <span className="subtle">This slug cannot be recovered from its env var name, so the token can never match. Re-enroll without consecutive hyphens.</span></dd></div>}
    </dl></div></section> : null}
    <CredentialLifecycle appId={app.id} credentials={credentials} beginAction={beginAdminRotationAction} revokeAction={revokeAppCredentialAction} />
  </AppShell>
}

function label(value: string): string { return value.split('_').map((part) => part.charAt(0) + part.slice(1).toLocaleLowerCase('en')).join(' ') }
