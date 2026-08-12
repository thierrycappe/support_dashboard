import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EnrollmentFlow from '@/components/enrollment/EnrollmentFlow'
import InvitationReveal from '@/components/enrollment/InvitationReveal'

const owners = [
  { id: 'user-1', name: 'Maya Chen', email: 'maya@example.test' },
  { id: 'user-2', name: 'Jonas Berg', email: 'jonas@example.test' },
]

describe('application enrollment flow', () => {
  it('keeps the approved four-step order and recovers from errors beside the field', () => {
    render(<EnrollmentFlow owners={owners} action={vi.fn()} />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Application'), expect.stringContaining('Owners'),
      expect.stringContaining('Alerts'), expect.stringContaining('Invitation'),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Continue to owners' }))
    expect(screen.getByText('Enter an application name, then continue.')).toBeVisible()
    expect(screen.getByLabelText('Application name')).toHaveAttribute('aria-invalid', 'true')

    fireEvent.change(screen.getByLabelText('Application name'), { target: { value: 'Atlas Checkout' } })
    fireEvent.change(screen.getByLabelText('Stable slug'), { target: { value: 'atlas-checkout' } })
    fireEvent.change(screen.getByLabelText('Application URL'), { target: { value: 'https://atlas.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to owners' }))
    expect(screen.getByRole('heading', { name: 'Owners' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to alerts' }))
    expect(screen.getByText('Select at least one owner, then continue.')).toBeVisible()
  })

  it('preserves entered values and reveals the returned invitation without browser persistence', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem')
    const action = vi.fn().mockResolvedValue({
      status: 'created', appId: 'app-1', invitationId: 'grant-1',
      invitationSecret: 'one-time-secret', expiresAt: '2026-08-12T15:30:00.000Z',
    })
    render(<EnrollmentFlow owners={owners} action={action} />)
    fireEvent.change(screen.getByLabelText('Application name'), { target: { value: 'Atlas Checkout' } })
    fireEvent.change(screen.getByLabelText('Stable slug'), { target: { value: 'atlas-checkout' } })
    fireEvent.change(screen.getByLabelText('Application URL'), { target: { value: 'https://atlas.example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to owners' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Maya Chen/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue to alerts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }))

    expect(await screen.findByText('one-time-secret')).toBeVisible()
    expect(screen.getByText('Invitation created')).toBeVisible()
    expect(screen.getByText(/shown only on this screen/)).toBeVisible()
    expect(action).toHaveBeenCalledOnce()
    const submitted = action.mock.calls[0]![1] as FormData
    expect(submitted.get('name')).toBe('Atlas Checkout')
    expect(submitted.getAll('ownerIds')).toEqual(['user-1'])
    expect(local).not.toHaveBeenCalled()
  })

  it('makes a revealed secret irrecoverable in the component after it is hidden', async () => {
    render(<InvitationReveal appId="app-1" invitationId="grant-1" invitationSecret="one-time-secret" expiresAt="2026-08-12T15:30:00.000Z" />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide invitation' }))
    expect(screen.queryByText('one-time-secret')).toBeNull()
    expect(screen.getByText('Invitation hidden')).toBeVisible()
    expect(screen.queryByRole('button', { name: /show/i })).toBeNull()
    await waitFor(() => expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/apps/app-1'))
  })

  it('clears the one-time secret when the page is left so history cannot reveal it', () => {
    render(<InvitationReveal appId="app-1" invitationId="grant-1" invitationSecret="one-time-secret" expiresAt="2026-08-12T15:30:00.000Z" />)
    fireEvent(window, new PageTransitionEvent('pagehide'))
    expect(screen.queryByText('one-time-secret')).toBeNull()
    expect(screen.getByText('Invitation hidden')).toBeVisible()
  })
})
