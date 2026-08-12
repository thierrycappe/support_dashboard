import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EscalationDetailContent from '@/components/escalations/EscalationDetailContent'
import type { EscalationDetail } from '@/lib/escalations/detail'

const detail: EscalationDetail = {
  ticket: {
    id: 'ticket-amber', externalId: 'ATLAS-42', title: 'Checkout stalls after payment',
    description: 'The payment confirmation never returns to the checkout view.', markdownSpec: null,
    kind: 'BUG', priority: 'URGENT', status: 'IN_REVIEW', reporterName: 'Maya Chen',
    reporterEmail: 'maya.chen@example.test', lastSyncedAt: new Date('2026-08-11T08:00:00.000Z'),
  },
  application: {
    name: 'Atlas Checkout', slug: 'atlas-checkout', sourceUrl: 'https://atlas.example/feedback/ATLAS-42',
    enrollmentStatus: 'ENROLLED', lastAuthenticatedAt: new Date('2026-08-12T08:30:00.000Z'),
  },
  approval: { ownerName: 'Maya Chen', ownerRef: 'owner-maya', escalatedAt: new Date('2026-08-12T07:00:00.000Z') },
  stale: true,
  pullConfigured: false,
  deliveryAttempts: [
    {
      id: 'attempt-later', target: 'Release alerts', ordinal: 2, startedAt: new Date('2026-08-12T09:15:00.000Z'),
      finishedAt: new Date('2026-08-12T09:15:05.000Z'), resultClass: 'sent', providerStatus: '202', sanitizedError: null,
    },
    {
      id: 'attempt-first', target: 'Release alerts', ordinal: 1, startedAt: new Date('2026-08-12T09:00:00.000Z'),
      finishedAt: new Date('2026-08-12T09:00:03.000Z'), resultClass: 'retryable', providerStatus: '503', sanitizedError: 'Provider was temporarily unavailable.',
    },
  ],
}

describe('escalation detail', () => {
  it('keeps approval, reporter context, and the labeled source action in the authenticated detail', () => {
    render(<EscalationDetailContent detail={detail} />)

    expect(screen.getByText('Approved by Maya Chen')).toBeVisible()
    expect(screen.getByText('maya.chen@example.test')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open source ticket for Checkout stalls after payment' })).toHaveAttribute('href', detail.application.sourceUrl)
    expect(screen.getByRole('link', { name: 'Open source ticket for Checkout stalls after payment' })).toHaveAttribute('target', '_blank')
  })

  it('states stale source health in text as well as its warning treatment', () => {
    render(<EscalationDetailContent detail={detail} />)

    expect(screen.getByText(/Stale sync, no source update since/i)).toBeVisible()
    expect(screen.getByText('Stale sync')).toHaveClass('ui-badge-warning')
  })

  it('renders delivery attempts as a chronological text timeline', () => {
    render(<EscalationDetailContent detail={detail} />)

    const timeline = screen.getByRole('list', { name: 'Delivery timeline' })
    const entries = within(timeline).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Attempt 1')
    expect(entries[0]).toHaveTextContent('Provider was temporarily unavailable.')
    expect(entries[1]).toHaveTextContent('Attempt 2')
    expect(entries[1]).toHaveTextContent('Succeeded')
  })
})
