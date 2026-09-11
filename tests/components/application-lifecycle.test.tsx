import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ApplicationLifecycle from '@/components/apps/ApplicationLifecycle'

const app = { id: 'app-1', name: 'Atlas', status: 'ACTIVE', enrollmentStatus: 'PENDING' }

it('offers resubmit only for unsuspended pending apps', () => {
  const { rerender } = render(<ApplicationLifecycle app={app} action={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Resubmit enrollment' })).toBeVisible()
  rerender(<ApplicationLifecycle app={{ ...app, status: 'PAUSED' }} action={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Resubmit enrollment' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Resume application' })).toBeVisible()
  rerender(<ApplicationLifecycle app={{ ...app, enrollmentStatus: 'ACTIVE' }} action={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Resubmit enrollment' })).toBeNull()
})
it('requires explicit confirmation and supports cancelling deletion', async () => {
  const action = vi.fn().mockResolvedValue({ status: 'success', message: 'Application deleted' })
  render(<ApplicationLifecycle app={app} action={action} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
  expect(action).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: 'I confirm deletion of Atlas' })).toBeRequired()
  expect(screen.getByRole('checkbox', { name: 'I confirm deletion of Atlas' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('button', { name: 'Confirm deletion' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Delete application' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Application deleted')
  const data = action.mock.calls[0][1] as FormData
  expect(data.get('operation')).toBe('delete')
  expect(data.get('confirmed')).toBe('on')
})
it('shows a replacement secret once and prevents further lifecycle actions during reveal', async () => {
  const action = vi.fn().mockResolvedValue({ status: 'created', appId: app.id, invitationId: 'grant-1', invitationSecret: 'replacement-secret', expiresAt: '2026-09-11T12:00:00Z' })
  render(<ApplicationLifecycle app={app} action={action} />)
  fireEvent.click(screen.getByRole('button', { name: 'Resubmit enrollment' }))
  expect(await screen.findByText('replacement-secret')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Delete application' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: /stored this invitation/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide invitation' }))
  expect(screen.queryByText('replacement-secret')).toBeNull()
})
