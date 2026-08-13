import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DeliveryTable from '@/components/deliveries/DeliveryTable'
import type { DeliveryOperationsRow } from '@/lib/delivery/queries'

const failedDelivery: DeliveryOperationsRow = {
  id: 'delivery-amber',
  eventKey: 'feedback.approved.amb-42',
  channelName: 'Release alerts',
  destination: 'm***@ops.example.test',
  channelType: 'EMAIL',
  status: 'FAILED' as const,
  nextAttemptAt: null,
  createdAt: new Date('2026-08-12T13:40:00.000Z'),
  updatedAt: new Date('2026-08-12T14:20:00.000Z'),
  attemptCount: 8,
  sanitizedCause: 'The destination rejected this message.',
  routingIncident: 'No active central fallback is available.',
  retryAvailable: true,
  nextAction: 'Retry delivery',
}

describe('delivery operations table', () => {
  it('explains a failed delivery with its sanitized cause and the next safe action', () => {
    render(
      <DeliveryTable
        view="failed"
        rows={[failedDelivery]}
        deadLetterCount={1}
        routingIncidentCount={1}
      />,
    )

    const row = screen.getByRole('row', { name: /Release alerts/ })
    expect(within(row).getByText('The destination rejected this message.')).toBeVisible()
    expect(within(row).getByText('Retry delivery')).toBeVisible()
    expect(within(row).getByText('No active central fallback is available.')).toBeVisible()
    expect(screen.getByText('1 dead letter')).toBeVisible()
    expect(screen.getByTestId('dead-letter-icon')).toBeVisible()
    expect(screen.getByText('1 routing incident')).toBeVisible()
    expect(screen.getByTestId('routing-incident-icon')).toBeVisible()
  })

  it('keeps a channel destination redacted in both active and unavailable views', () => {
    render(
      <DeliveryTable
        view="history"
        rows={[{ ...failedDelivery, status: 'SENT', sanitizedCause: null, routingIncident: null, retryAvailable: false }]}
        deadLetterCount={0}
        routingIncidentCount={0}
      />,
    )

    expect(screen.getByText('m***@ops.example.test')).toBeVisible()
    expect(screen.queryByText('maya.chen@ops.example.test')).toBeNull()
  })

  it('renders an explicit UTC timestamp that is identical during server render and hydration', () => {
    render(
      <DeliveryTable
        view="history"
        rows={[{ ...failedDelivery, status: 'SENT', retryAvailable: false }]}
        deadLetterCount={0}
        routingIncidentCount={0}
      />,
    )

    const recorded = screen.getByText('Aug 12, 2026, 1:40 PM UTC')
    expect(recorded).toHaveAttribute('datetime', '2026-08-12T13:40:00.000Z')
  })

  it('teaches an empty operational view without a generic no-data message', () => {
    render(<DeliveryTable view="retrying" rows={[]} deadLetterCount={0} routingIncidentCount={0} />)

    expect(screen.getByRole('heading', { name: 'No deliveries are retrying' })).toBeVisible()
    expect(screen.getByText(/retrying deliveries appear after a temporary provider failure/i)).toBeVisible()
  })

  it('shows an unroutable incident as a failed operational row with a next action instead of a retry', () => {
    render(<DeliveryTable view="failed" rows={[{
      ...failedDelivery, id: 'incident:routing-amber', channelName: 'Routing decision', destination: 'No active technical route',
      retryAvailable: false, sanitizedCause: null, routingIncident: 'No active central fallback is available.',
      nextAction: 'Configure an active technical route, then resend the escalation.',
    }]} deadLetterCount={0} routingIncidentCount={1} />)
    expect(screen.getByText('Configure an active technical route, then resend the escalation.')).toBeVisible()
    expect(screen.queryByText('Retry delivery')).toBeNull()
  })
})
