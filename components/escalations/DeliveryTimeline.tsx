import type { DeliveryTimelineAttempt } from '@/lib/escalations/detail'

const timestamp = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
})

export default function DeliveryTimeline({ attempts }: { attempts: DeliveryTimelineAttempt[] }) {
  const chronological = [...attempts].sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime() || left.id.localeCompare(right.id))

  return (
    <section className="delivery-timeline" aria-labelledby="delivery-timeline-title">
      <div className="detail-section-heading"><h2 id="delivery-timeline-title">Delivery timeline</h2><span className="subtle">{chronological.length} attempts</span></div>
      {chronological.length === 0 ? (
        <p className="subtle">No delivery attempt has been recorded for this escalation.</p>
      ) : (
        <ol aria-label="Delivery timeline">
          {chronological.map((attempt) => (
            <li key={attempt.id}>
              <time dateTime={attempt.startedAt.toISOString()}>{timestamp.format(attempt.startedAt)} UTC</time>
              <div>
                <strong>Attempt {attempt.ordinal} · {resultLabel(attempt.resultClass)}</strong>
                <span>{attempt.target}{attempt.providerStatus ? ` · Provider ${attempt.providerStatus}` : ''}</span>
                {attempt.sanitizedError ? <p>{attempt.sanitizedError}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function resultLabel(resultClass: string): string {
  if (resultClass === 'sent') return 'Succeeded'
  if (resultClass === 'retryable') return 'Retry scheduled'
  if (resultClass === 'permanent') return 'Failed permanently'
  if (resultClass === 'CONFIGURATION_NOT_READY') return 'Configuration unavailable'
  return 'Delivery recorded'
}
