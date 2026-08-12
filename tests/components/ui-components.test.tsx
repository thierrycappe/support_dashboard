import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import DataTable from '@/components/ui/DataTable'
import EmptyState from '@/components/ui/EmptyState'
import InlineNotice from '@/components/ui/InlineNotice'
import Pagination from '@/components/ui/Pagination'

describe('product UI primitives', () => {
  it('exposes button loading and disabled states without losing its label', () => {
    const { rerender } = render(<Button variant="primary">Save policy</Button>)
    expect(screen.getByRole('button', { name: 'Save policy' })).toBeEnabled()

    rerender(<Button loading>Save policy</Button>)
    expect(screen.getByRole('button', { name: 'Save policy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save policy' })).toHaveAttribute('aria-busy', 'true')
  })

  it('pairs every semantic badge color with visible text', () => {
    render(<Badge tone="warning">Retrying</Badge>)
    expect(screen.getByText('Retrying')).toBeVisible()
  })

  it('announces actionable notices by semantic urgency', () => {
    render(<InlineNotice tone="danger" title="Delivery failed">Check the channel configuration, then retry delivery.</InlineNotice>)
    const notice = screen.getByRole('alert')
    expect(within(notice).getByText('Delivery failed')).toBeVisible()
    expect(within(notice).getByText(/then retry delivery/)).toBeVisible()
  })

  it('teaches why a queue is empty and what creates an entry', () => {
    render(
      <EmptyState
        title="No deliveries yet"
        description="Deliveries appear after an escalation matches an active notification policy."
        action={<a href="/apps">Review applications</a>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No deliveries yet' })).toBeVisible()
    expect(screen.getByText(/after an escalation matches/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Review applications' })).toBeVisible()
  })

  it('renders a labelled, keyboard-scrollable data table with responsive cell labels', () => {
    render(
      <DataTable
        caption="Delivery queue"
        columns={[
          { key: 'target', header: 'Target' },
          { key: 'status', header: 'Status' },
        ]}
        rows={[{ id: 'delivery-1', target: 'Operations email', status: 'Pending' }]}
        getRowKey={(row) => row.id}
        emptyState={<EmptyState title="No deliveries yet" description="Deliveries appear after an escalation matches a policy." />}
      />,
    )
    const region = screen.getByRole('region', { name: 'Delivery queue' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table', { name: 'Delivery queue' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'Operations email' })).toHaveAttribute('data-label', 'Target')
  })

  it('renders loading and teaching-empty table states', () => {
    const columns = [{ key: 'name' as const, header: 'Application' }]
    const { rerender } = render(
      <DataTable<{ name: string }>
        caption="Applications"
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.name}
        loading
        emptyState={<EmptyState title="No applications connected" description="Applications appear after a connector enrolls." />}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading applications')

    rerender(
      <DataTable<{ name: string }>
        caption="Applications"
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.name}
        emptyState={<EmptyState title="No applications connected" description="Applications appear after a connector enrolls." />}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No applications connected' })).toBeVisible()
  })

  it('labels pagination, marks the current page, and disables unavailable steps', () => {
    render(<Pagination currentPage={1} totalPages={3} hrefForPage={(page) => `/deliveries?page=${page}`} />)
    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(pagination).getByText('Previous')).toHaveAttribute('aria-disabled', 'true')
    expect(within(pagination).getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(within(pagination).getByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/deliveries?page=2')
  })
})
