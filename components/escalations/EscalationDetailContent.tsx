import Badge from '@/components/ui/Badge'
import RefreshFromSourceButton from '@/components/RefreshFromSourceButton'
import DeliveryTimeline from '@/components/escalations/DeliveryTimeline'
import type { EscalationDetail } from '@/lib/escalations/detail'
import { kindLabel, visibleStatusLabel } from '@/lib/feedback/status'

const timestamp = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

export default function EscalationDetailContent({ detail }: { detail: EscalationDetail }) {
  const reporter = detail.ticket.reporterEmail ?? detail.ticket.reporterName ?? 'Not provided by the source application'
  const approval = detail.approval
    ? detail.approval.ownerName ? `Approved by ${detail.approval.ownerName}` : 'Approved in application'
    : 'Business approval not recorded'

  return (
    <>
      <header className="topbar detail-topbar">
        <div>
          <p className="eyebrow">{detail.application.name} · {detail.ticket.externalId}</p>
          <h1>{detail.ticket.title}</h1>
          <p className="subtle">{kindLabel(detail.ticket.kind)} · {visibleStatusLabel(detail.ticket.status)}</p>
        </div>
        <div className="detail-health" aria-label="Source health">
          <Badge tone={detail.stale ? 'warning' : 'success'}>{detail.stale ? 'Stale sync' : 'Source sync current'}</Badge>
          <span>{detail.stale ? `Stale sync, no source update since ${timestamp.format(detail.ticket.lastSyncedAt)} UTC.` : `Last source update ${timestamp.format(detail.ticket.lastSyncedAt)} UTC.`}</span>
        </div>
      </header>

      <section className="detail-layout" aria-label="Escalation detail">
        <div className="detail-main">
          <section className="detail-section" aria-labelledby="description-title">
            <h2 id="description-title">Description</h2>
            <p className="detail-prose">{detail.ticket.description}</p>
            {detail.ticket.markdownSpec ? <><h2>Specification</h2><pre>{detail.ticket.markdownSpec}</pre></> : null}
          </section>
          <DeliveryTimeline attempts={detail.deliveryAttempts} />
        </div>
        <aside className="detail-sidebar" aria-label="Escalation context">
          <section className="detail-section">
            <h2>Business approval</h2>
            <p><strong>{approval}</strong></p>
            {detail.approval ? <p className="subtle">Escalated {timestamp.format(detail.approval.escalatedAt)} UTC</p> : <p className="subtle">Only canonically approved feedback enters the technical queue.</p>}
          </section>
          <section className="detail-section">
            <h2>Source application</h2>
            <dl className="detail-facts">
              <div><dt>Application</dt><dd>{detail.application.name}</dd></div>
              <div><dt>Connection</dt><dd>{detail.application.enrollmentStatus === 'ENROLLED' ? 'Credential enrolled' : 'Credential enrollment pending'}</dd></div>
              <div><dt>Last authenticated</dt><dd>{detail.application.lastAuthenticatedAt ? `${timestamp.format(detail.application.lastAuthenticatedAt)} UTC` : 'Not authenticated yet'}</dd></div>
              <div><dt>Reporter</dt><dd>{reporter}</dd></div>
            </dl>
            {detail.application.sourceUrl ? <a className="detail-source-link" href={detail.application.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open source ticket for ${detail.ticket.title}`}>Open source ticket</a> : <p className="subtle">Source link unavailable.</p>}
            {detail.pullConfigured ? <div className="detail-refresh"><RefreshFromSourceButton ticketId={detail.ticket.id} /></div> : null}
          </section>
        </aside>
      </section>
    </>
  )
}
