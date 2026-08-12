'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

interface Props {
  ticketId: string
}

export default function RefreshFromSourceButton({ ticketId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const inFlight = useRef(false)
  const busy = isRefreshing || isPending

  async function handleClick() {
    if (inFlight.current) return
    inFlight.current = true
    setIsRefreshing(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/feedback/${ticketId}/refresh`, {
        method: 'POST',
      })
      if (!response.ok) {
        setMessage({ tone: 'error', text: 'Source refresh could not be completed. Try again later.' })
        return
      }
      const body = await response.json().catch(() => null) as { changed?: boolean } | null
      setMessage({ tone: 'success', text: body?.changed === false ? 'Source data is already current.' : 'Source data refreshed.' })
      startTransition(() => router.refresh())
    } catch {
      setMessage({ tone: 'error', text: 'Source refresh could not be completed. Try again later.' })
    } finally {
      inFlight.current = false
      setIsRefreshing(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className="button"
        onClick={handleClick}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <RefreshCw size={14} />
        {busy ? 'Refreshing…' : 'Refresh from source'}
      </button>
      {message && (
        <span className="subtle" role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </span>
      )}
    </div>
  )
}
