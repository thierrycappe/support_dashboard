'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'

export default function InvitationReveal({ appId, invitationId, invitationSecret, expiresAt }: { appId: string; invitationId: string; invitationSecret: string; expiresAt: string }) {
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [leaveWarning, setLeaveWarning] = useState(false)
  useEffect(() => {
    const hide = () => setVisible(false)
    window.addEventListener('pagehide', hide)
    return () => window.removeEventListener('pagehide', hide)
  }, [])
  useEffect(() => {
    if (acknowledged || !visible) return
    const protectUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const protectLink = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a[href]')) { event.preventDefault(); setLeaveWarning(true) }
    }
    const revealUrl = window.location.href
    window.history.pushState({ invitationGuard: invitationId }, '', revealUrl)
    const protectBack = () => { window.history.pushState({ invitationGuard: invitationId }, '', revealUrl); setLeaveWarning(true) }
    window.addEventListener('beforeunload', protectUnload)
    window.addEventListener('popstate', protectBack)
    document.addEventListener('click', protectLink, true)
    return () => { window.removeEventListener('beforeunload', protectUnload); window.removeEventListener('popstate', protectBack); document.removeEventListener('click', protectLink, true) }
  }, [acknowledged, invitationId, visible])
  if (!visible) return <div role="status"><h2>Invitation hidden</h2><p className="subtle">The secret cannot be shown again. Create a new invitation if it was not stored.</p><Link className="ui-button ui-button-primary" href={`/apps/${appId}` as Route}>View application</Link></div>
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ id: invitationId, secret: invitationSecret }))
      setCopied(true); setAcknowledged(true); setCopyError(false); setLeaveWarning(false)
    } catch { setCopyError(true) }
  }
  return <section aria-labelledby="invitation-title"><p className="eyebrow">Step 4 of 4</p><h2 id="invitation-title">Invitation created</h2><p>This invitation is shown only on this screen. Store it in the application configuration before leaving.</p>{copyError ? <p className="field-error" role="alert">Invitation was not copied. Select the values and copy them manually.</p> : null}{leaveWarning ? <p className="field-error" role="alert">Store or copy the invitation before leaving this screen.</p> : null}<dl><div><dt>Invitation ID</dt><dd><code>{invitationId}</code></dd></div><div><dt>Invitation secret</dt><dd><code>{invitationSecret}</code></dd></div><div><dt>Expires</dt><dd><time dateTime={expiresAt}>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(expiresAt))}</time></dd></div></dl><label className="enrollment-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); if (event.target.checked) { setCopyError(false); setLeaveWarning(false) } }} /> I stored this invitation in the application configuration</label><div className="form-actions enrollment-actions"><Button type="button" onClick={copy}>{copied ? 'Invitation copied' : 'Copy invitation'}</Button><Button type="button" variant="secondary" disabled={!acknowledged} onClick={() => setVisible(false)}>Hide invitation</Button></div></section>
}
