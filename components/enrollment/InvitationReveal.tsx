'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'

export default function InvitationReveal({ appId, invitationId, invitationSecret, expiresAt }: { appId: string; invitationId: string; invitationSecret: string; expiresAt: string }) {
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const hide = () => setVisible(false)
    window.addEventListener('pagehide', hide)
    return () => window.removeEventListener('pagehide', hide)
  }, [])
  if (!visible) return <div role="status"><h2>Invitation hidden</h2><p className="subtle">The secret cannot be shown again. Create a new invitation if it was not stored.</p><Link className="ui-button ui-button-primary" href={`/apps/${appId}` as Route}>View application</Link></div>
  const copy = async () => { await navigator.clipboard.writeText(JSON.stringify({ id: invitationId, secret: invitationSecret })); setCopied(true) }
  return <section aria-labelledby="invitation-title"><p className="eyebrow">Step 4 of 4</p><h2 id="invitation-title">Invitation created</h2><p>This invitation is shown only on this screen. Store it in the application configuration before leaving.</p><dl><div><dt>Invitation ID</dt><dd><code>{invitationId}</code></dd></div><div><dt>Invitation secret</dt><dd><code>{invitationSecret}</code></dd></div><div><dt>Expires</dt><dd><time dateTime={expiresAt}>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(expiresAt))}</time></dd></div></dl><div className="form-actions"><Button type="button" onClick={copy}>{copied ? 'Invitation copied' : 'Copy invitation'}</Button><Button type="button" variant="secondary" onClick={() => setVisible(false)}>Hide invitation</Button></div></section>
}
