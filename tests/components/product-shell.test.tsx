import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/deliveries' }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: 'system' }) })) }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { name: 'Morgan Lee', role: 'ADMIN' } })) }))
vi.mock('@/app/login/actions', () => ({ logoutAction: vi.fn() }))

import AppShell from '@/components/AppShell'
import NavLinks from '@/components/NavLinks'
import ThemeToggle from '@/components/ThemeToggle'

let triggerResizeObserver: (element: Element) => void
const disconnectResizeObserver = vi.fn()
const observedResizeElements = new Set<Element>()

describe('product shell', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.cookie = 'support-theme=; Max-Age=0; Path=/'
    Element.prototype.scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollBy = vi.fn()
    disconnectResizeObserver.mockClear()
    observedResizeElements.clear()
    vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
      private readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        triggerResizeObserver = (element) => {
          if (!observedResizeElements.has(element)) return
          this.callback([{ target: element } as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
      }

      observe(element: Element) { observedResizeElements.add(element) }
      unobserve(element: Element) { observedResizeElements.delete(element) }
      disconnect() {
        observedResizeElements.clear()
        disconnectResizeObserver()
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes ordered navigation landmarks and the active destination', () => {
    render(<NavLinks pathname="/deliveries" isAdmin deadLetterCount={2} />)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Escalations',
      'Applications',
      'Deliveries',
      'Teams',
      'Access',
    ])
    expect(screen.getByRole('link', { name: 'Deliveries' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('2 dead letters')).toBeVisible()
  })

  it('keeps administrative destinations out of the support navigation', () => {
    render(<NavLinks pathname="/" isAdmin={false} />)
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Access' })).not.toBeInTheDocument()
  })

  it('reveals a deep active destination and exposes explicit mobile scroll controls', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    render(<NavLinks pathname="/users" isAdmin />)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    setElementClientWidth(navigation.parentElement as HTMLElement, 300)
    setNavigationMetrics(navigation, { clientWidth: 300, scrollWidth: 700, scrollLeft: 400 })
    act(() => triggerResizeObserver(navigation))

    expect(screen.getByRole('link', { name: 'Access' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Access' })).toHaveAttribute('aria-current', 'page')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'center' })
    expect(await screen.findByRole('button', { name: 'Scroll navigation left' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Scroll navigation right' })).toBeVisible()
  })

  it('centers the new active destination after a pathname change', () => {
    const { rerender } = render(<NavLinks pathname="/deliveries" isAdmin />)
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    rerender(<NavLinks pathname="/users" isAdmin />)

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'center' })
  })

  it('hides mobile scroll controls and reclaims their space when navigation does not overflow', async () => {
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<NavLinks pathname="/" isAdmin />)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    setElementClientWidth(navigation.parentElement as HTMLElement, 500)
    setNavigationMetrics(navigation, { clientWidth: 500, scrollWidth: 500, scrollLeft: 0 })

    act(() => window.dispatchEvent(new Event('resize')))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Scroll navigation left' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Scroll navigation right' })).not.toBeInTheDocument()
    expect(navigation.parentElement).not.toHaveAttribute('data-overflow')
    unmount()
    expect(disconnectResizeObserver).toHaveBeenCalledOnce()
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('tracks native disabled scroll boundaries and updates after scroll and resize', async () => {
    render(<NavLinks pathname="/deliveries" isAdmin />)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    const rail = navigation.parentElement as HTMLElement
    setElementClientWidth(rail, 500)
    setNavigationMetrics(navigation, { clientWidth: 300, scrollWidth: 700, scrollLeft: 0 })

    act(() => triggerResizeObserver(navigation))

    const previous = await screen.findByRole('button', { name: 'Scroll navigation left' })
    const next = screen.getByRole('button', { name: 'Scroll navigation right' })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()
    expect(previous).toHaveAttribute('type', 'button')
    fireEvent.click(next)
    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalledWith({ behavior: 'auto', left: 240 })

    setNavigationMetrics(navigation, { clientWidth: 300, scrollWidth: 700, scrollLeft: 180 })
    act(() => navigation.dispatchEvent(new Event('scroll')))
    await waitFor(() => expect(previous).toBeEnabled())
    expect(next).toBeEnabled()

    setNavigationMetrics(navigation, { clientWidth: 300, scrollWidth: 700, scrollLeft: 400 })
    act(() => navigation.dispatchEvent(new Event('scroll')))
    await waitFor(() => expect(next).toBeDisabled())
    expect(previous).toBeEnabled()

    setElementClientWidth(rail, 700)
    setNavigationMetrics(navigation, { clientWidth: 700, scrollWidth: 700, scrollLeft: 0 })
    act(() => window.dispatchEvent(new Event('resize')))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Scroll navigation right' })).not.toBeInTheDocument())
    expect(navigation.parentElement).not.toHaveAttribute('data-overflow')
  })

  it('drops self-sustaining controls when content fits the full rail and restores them after growth', async () => {
    render(<NavLinks pathname="/deliveries" isAdmin />)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    const rail = navigation.parentElement as HTMLElement

    setElementClientWidth(rail, 500)
    setNavigationMetrics(navigation, { clientWidth: 404, scrollWidth: 700, scrollLeft: 0 })
    act(() => triggerResizeObserver(navigation))
    expect(await screen.findByRole('button', { name: 'Scroll navigation right' })).toBeEnabled()

    setElementClientWidth(rail, 650)
    setNavigationMetrics(navigation, { clientWidth: 554, scrollWidth: 620, scrollLeft: 50 })
    act(() => triggerResizeObserver(navigation))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Scroll navigation right' })).not.toBeInTheDocument())
    expect(navigation).toHaveProperty('scrollLeft', 0)

    setNavigationMetrics(navigation, { clientWidth: 650, scrollWidth: 720, scrollLeft: 0 })
    act(() => triggerResizeObserver(rail))
    expect(await screen.findByRole('button', { name: 'Scroll navigation right' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Scroll navigation left' })).toBeDisabled()
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

function setNavigationMetrics(
  navigation: HTMLElement,
  metrics: { clientWidth: number; scrollWidth: number; scrollLeft: number },
) {
  Object.defineProperties(navigation, {
    clientWidth: { configurable: true, value: metrics.clientWidth },
    scrollWidth: { configurable: true, value: metrics.scrollWidth },
    scrollLeft: { configurable: true, writable: true, value: metrics.scrollLeft },
  })
}

function setElementClientWidth(element: HTMLElement, clientWidth: number) {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth })
}
