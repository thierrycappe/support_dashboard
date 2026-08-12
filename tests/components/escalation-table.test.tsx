import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EscalationTable from '@/components/escalations/EscalationTable'
import type { EscalationQueueRow } from '@/lib/escalations/queries'

const row: EscalationQueueRow = {
  id: 'ticket-1', title: 'Checkout stalls after payment', appId: 'app-one', appName: 'Atlas Checkout',
  kind: 'BUG', priority: 'URGENT', status: 'NEW', deliveryStatus: 'RETRYING',
  ownerApproval: 'Approved by Maya Chen', updatedAt: new Date('2026-08-12T14:30:00.000Z'),
  sourceUrl: 'https://atlas.example/feedback/source-42',
}

describe('escalation queue table', () => {
  it('keeps portal detail primary and labels source and delivery state separately', () => {
    render(<EscalationTable rows={[row]} nextHref="/?cursor=next" hasFilters={false} />)
    expect(screen.getByRole('link', { name: 'Checkout stalls after payment' })).toHaveAttribute('href', '/feedback/ticket-1')
    expect(screen.getByRole('link', { name: 'Open source ticket' })).toHaveAttribute('href', row.sourceUrl)
    expect(screen.getByText('Retrying')).toBeVisible()
    expect(screen.getByText('Approved by Maya Chen')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Escalations queue' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('link', { name: 'Next queue page' })).toHaveAttribute('href', '/?cursor=next')
    expect(document.querySelector('.stats-grid')).toBeNull()
  })

  it('teaches the two-tier boundary for an empty queue and distinguishes filtered emptiness', () => {
    const { rerender } = render(<EscalationTable rows={[]} nextHref={null} hasFilters={false} />)
    expect(screen.getByRole('heading', { name: 'No escalations yet' })).toBeVisible()
    expect(screen.getByText(/business-approved in an application/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Review applications' })).toHaveAttribute('href', '/apps')

    rerender(<EscalationTable rows={[]} nextHref={null} hasFilters />)
    const table = screen.getByRole('table', { name: 'Escalations queue' })
    expect(within(table).getByRole('heading', { name: 'No matching escalations' })).toBeVisible()
    expect(within(table).getByText(/Change or clear the filters/)).toBeVisible()
  })
})
