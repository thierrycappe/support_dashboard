import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/deliveries' }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: 'system' }) })) }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { name: 'Morgan Lee', role: 'ADMIN' } })) }))
vi.mock('@/app/login/actions', () => ({ logoutAction: vi.fn() }))

import AppShell from '@/components/AppShell'
import NavLinks from '@/components/NavLinks'
import ThemeToggle from '@/components/ThemeToggle'

describe('product shell', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.cookie = 'support-theme=; Max-Age=0; Path=/'
  })

  it('exposes ordered navigation landmarks and the active destination', () => {
    render(<NavLinks pathname="/deliveries" isAdmin />)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Escalations',
      'Applications',
      'Deliveries',
      'Teams',
      'Access',
    ])
    expect(screen.getByRole('link', { name: 'Deliveries' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps administrative destinations out of the support navigation', () => {
    render(<NavLinks pathname="/" isAdmin={false} />)
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Access' })).not.toBeInTheDocument()
  })

  it('renders the authenticated shell as server content with a skip link and main landmark', async () => {
    render(await AppShell({ children: <h1>Open escalations</h1> }))
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(screen.getByText('Morgan Lee')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  it('persists an explicit theme and removes the attribute for system mode', () => {
    render(<ThemeToggle initialTheme="light" />)

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.cookie).toContain('support-theme=dark')
    expect(screen.getByRole('button', { name: 'Use dark theme' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Use system theme' }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(document.cookie).toContain('support-theme=system')
  })
})
