import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Link from 'next/link'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EnrollmentFlow from '@/components/enrollment/EnrollmentFlow'
import InvitationReveal from '@/components/enrollment/InvitationReveal'

const owners = [
  { id: 'user-1', name: 'Maya Chen', email: 'maya@example.test' },
  { id: 'user-2', name: 'Jonas Berg', email: 'jonas@example.test' },
]

afterEach(() => vi.restoreAllMocks())

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
    expect(screen.getByRole('button', { name: 'Hide invitation' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /stored this invitation/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide invitation' }))
    expect(screen.queryByText('one-time-secret')).toBeNull()
    expect(screen.getByText('Invitation hidden')).toBeVisible()
    expect(screen.queryByRole('button', { name: /show/i })).toBeNull()
    await waitFor(() => expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/apps/app-1'))
  })

  it('blocks refresh, restores Back without a duplicate entry, and removes the guard after acknowledgement', async () => {
    window.history.replaceState({ nextRouterState: 'preserved' }, '', '/apps/new')
    const initialLength = window.history.length
    const push = vi.spyOn(window.history, 'pushState')
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined)
    render(<><Link href="/apps">Applications</Link><InvitationReveal appId="app-1" invitationId="grant-1" invitationSecret="one-time-secret" expiresAt="2026-08-12T15:30:00.000Z" /></>)
    expect(push).not.toHaveBeenCalled()
    expect(window.history.length).toBe(initialLength)
    const guardedState = window.history.state
    expect(guardedState).toMatchObject({ nextRouterState: 'preserved' })
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
    expect(fireEvent.click(screen.getByRole('link', { name: 'Applications' }))).toBe(false)
    const back = new PopStateEvent('popstate', { state: { previousRoute: true } })
    const stopped = vi.spyOn(back, 'stopImmediatePropagation')
    fireEvent(window, back)
    expect(stopped).toHaveBeenCalledOnce()
    expect(forward).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent('Store or copy the invitation before leaving this screen.')
    expect(screen.getByText('one-time-secret')).toBeVisible()
    fireEvent(window, new PopStateEvent('popstate', { state: guardedState }))
    expect(forward).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('checkbox', { name: /stored this invitation/ }))
    await waitFor(() => expect(window.history.state).toEqual({ nextRouterState: 'preserved' }))
    const acknowledgedLeaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(acknowledgedLeaving)
    expect(acknowledgedLeaving.defaultPrevented).toBe(false)
    fireEvent(window, new PopStateEvent('popstate', { state: { previousRoute: true } }))
    expect(forward).toHaveBeenCalledOnce()
    expect(window.history.length).toBe(initialLength)
  })

  it('clears an acknowledged secret on pagehide so browser cache cannot restore it', () => {
    render(<InvitationReveal appId="app-1" invitationId="grant-1" invitationSecret="one-time-secret" expiresAt="2026-08-12T15:30:00.000Z" />)
    fireEvent.click(screen.getByRole('checkbox', { name: /stored this invitation/ }))
    fireEvent(window, new PageTransitionEvent('pagehide', { persisted: true }))
    expect(screen.queryByText('one-time-secret')).toBeNull()
    fireEvent.popState(window)
    expect(screen.queryByText('one-time-secret')).toBeNull()
    expect(screen.getByText('Invitation hidden')).toBeVisible()
  })

  it('keeps manual copy available and shows factual recovery when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<InvitationReveal appId="app-1" invitationId="grant-1" invitationSecret="one-time-secret" expiresAt="2026-08-12T15:30:00.000Z" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy invitation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation was not copied. Select the values and copy them manually.')
    expect(screen.getByText('one-time-secret')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hide invitation' })).toBeDisabled()
  })

  it('renders one semantic step number and stacks owners and actions at small widths', () => {
    render(<EnrollmentFlow owners={owners} action={vi.fn()} />)
    const progress = screen.getByRole('navigation', { name: 'Enrollment progress' })
    expect(progress).toHaveTextContent('ApplicationOwnersAlertsInvitation')
    expect(progress).not.toHaveTextContent('1. Application')
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\.enrollment-steps\s*\{[\s\S]*?list-style-position:\s*inside/)
    expect(css).toMatch(/\.enrollment-owner-list label,[\s\S]*?min-height:\s*44px/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.enrollment-actions\s*\{[\s\S]*?flex-direction:\s*column/)
  })
})
