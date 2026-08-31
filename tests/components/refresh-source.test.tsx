import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RefreshFromSourceButton from '@/components/RefreshFromSourceButton'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

describe('refresh from source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables immediately during the complete source fetch and reports a factual no-change result', async () => {
    let resolveFetch: (value: Response) => void = () => undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    render(<RefreshFromSourceButton ticketId="ticket-amber" />)

    const button = screen.getByRole('button', { name: 'Refresh from source' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(fetchMock).toHaveBeenCalledOnce()
    resolveFetch(new Response(JSON.stringify({ ok: true, changed: false }), { status: 200 }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Source data is already current.'))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('shows a fixed recovery message instead of an upstream error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'provider token leaked' }), { status: 502 })))
    render(<RefreshFromSourceButton ticketId="ticket-amber" />)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh from source' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Source refresh could not be completed. Try again later.')
    expect(screen.queryByText('provider token leaked')).toBeNull()
  })
})
