'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

interface Props {
  ticketId: string
}

export default function RefreshFromSourceButton({ ticketId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    try {
      const response = await fetch(`/api/feedback/${ticketId}/refresh`, {
        method: 'POST',
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        setError(body?.error ?? `Refresh failed (${response.status})`)
        return
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className="button"
        onClick={handleClick}
        disabled={isPending}
      >
        <RefreshCw size={14} />
        {isPending ? 'Refreshing…' : 'Refresh from source'}
      </button>
      {error && (
        <span className="subtle" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </div>
  )
}
