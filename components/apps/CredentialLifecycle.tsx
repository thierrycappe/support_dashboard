'use client'

import { useActionState, useEffect, useState } from 'react'
import type { ActionState, CredentialRotationActionState } from '@/app/apps/actions'
import type { ApplicationCredentialInventoryRow } from '@/lib/apps/queries'
import Badge, { type BadgeTone } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import FieldError from '@/components/ui/FieldError'

type BeginAction = (state: CredentialRotationActionState, formData: FormData) => Promise<CredentialRotationActionState>
type RevokeAction = (state: ActionState, formData: FormData) => Promise<ActionState>
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

export default function CredentialLifecycle({
  appId,
  credentials,
  beginAction,
  revokeAction,
}: {
  appId: string
  credentials: ApplicationCredentialInventoryRow[]
  beginAction: BeginAction
  revokeAction: RevokeAction
}) {
  const [state, formAction, pending] = useActionState(beginAction, { status: 'idle' } as CredentialRotationActionState)
  const preferredParent = credentials.find((credential) => credential.health === 'ACTIVE' && credential.canRotateFrom)
    ?? credentials.find((credential) => credential.canRotateFrom)
  const availableParents = credentials.filter((credential) => credential.canRotateFrom)

  return <section className="operations-section credential-lifecycle" aria-labelledby="credential-health-title">
    <div>
      <p className="eyebrow">Connector identity</p>
      <h2 id="credential-health-title">Credential health</h2>
      <p className="subtle">Inspect public-key health, assist a connector rotation, or revoke a superseded credential. The private key stays in the connector.</p>
    </div>
    {credentials.length === 0 ? <p className="subtle">No public-key credentials are registered for this application.</p> : <div className="credential-ledger" role="list" aria-label="Application credentials">
      {credentials.map((credential) => <CredentialRow key={credential.id} appId={appId} credential={credential} action={revokeAction} />)}
    </div>}
    <form className="credential-rotation-form" action={formAction} aria-labelledby="begin-rotation-title">
      <div>
        <h3 id="begin-rotation-title">Assist key rotation</h3>
        <p className="subtle">Register the connector’s new public key. The connector must sign the returned challenge with its new private key and confirm through the existing proof endpoint before activation.</p>
      </div>
      {state.status === 'error' ? <p className="field-error" role="alert">{state.message}</p> : null}
      <input type="hidden" name="appId" value={appId} />
      <div className="field">
        <label htmlFor="rotation-parent">Current active credential</label>
        <select id="rotation-parent" name="parentCredentialId" defaultValue={preferredParent?.id ?? ''} disabled={availableParents.length === 0} aria-describedby="rotation-parent-help">
          {availableParents.length === 0 ? <option value="">No active credential available</option> : availableParents.map((credential) => <option key={credential.id} value={credential.id}>{credential.id} · {healthLabel(credential.health)}</option>)}
        </select>
        <p id="rotation-parent-help" className="field-help">This credential authenticates the connector’s confirmation request. Its private key is never submitted here.</p>
        {state.status === 'error' && state.fieldErrors.parentCredentialId?.[0] ? <FieldError>{state.fieldErrors.parentCredentialId[0]}</FieldError> : null}
      </div>
      <div className="field">
        <label htmlFor="rotation-public-jwk">New Ed25519 public JWK</label>
        <textarea id="rotation-public-jwk" name="publicJwk" rows={5} spellCheck={false} autoComplete="off" placeholder={'{"kty":"OKP","crv":"Ed25519","x":"…"}'} aria-describedby="rotation-public-jwk-help" />
        <p id="rotation-public-jwk-help" className="field-help">Only a strict public JWK is accepted. Do not paste a private JWK.</p>
        {state.status === 'error' && state.fieldErrors.publicJwk?.[0] ? <FieldError>{state.fieldErrors.publicJwk[0]}</FieldError> : null}
      </div>
      <div className="form-actions credential-actions"><Button type="submit" loading={pending} disabled={availableParents.length === 0}>Begin key rotation</Button></div>
    </form>
    {state.status === 'created' ? <RotationChallengeReveal {...state} /> : null}
  </section>
}

function CredentialRow({
  appId,
  credential,
  action,
}: {
  appId: string
  credential: ApplicationCredentialInventoryRow
  action: RevokeAction
}) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as ActionState)
  return <article className="credential-row" role="listitem" aria-labelledby={`credential-${credential.id}`}>
    <div className="credential-identity">
      <code id={`credential-${credential.id}`}>{credential.id}</code>
      <span className="subtle">Key {shortThumbprint(credential.thumbprint)}</span>
    </div>
    <div className="credential-health"><Badge tone={healthTone(credential.health)}>{healthLabel(credential.health)}</Badge>{credential.validUntil ? <span className="subtle">Until <time dateTime={credential.validUntil}>{formatDate(credential.validUntil)}</time></span> : <span className="subtle">No scheduled expiry</span>}</div>
    <div className="credential-context"><span>Created <time dateTime={credential.createdAt}>{formatDate(credential.createdAt)}</time></span>{credential.parentCredentialId ? <span className="subtle">Rotated from <code>{credential.parentCredentialId}</code></span> : <span className="subtle">Initial credential</span>}</div>
    <form action={formAction} className="credential-revoke-form">
      <input type="hidden" name="appId" value={appId} />
      <input type="hidden" name="credentialId" value={credential.id} />
      {credential.canRevoke ? <Button type="submit" variant="danger" loading={pending} aria-label={`Revoke credential ${credential.id}`}>Revoke credential</Button> : credential.health === 'ACTIVE' || credential.health === 'OVERLAP' ? <span className="subtle">Keep one active credential</span> : null}
      {state.status === 'success' ? <p role="status" className="success-message">{state.message}</p> : null}
      {state.status === 'error' ? <p role="alert" className="field-error">{state.message}</p> : null}
    </form>
  </article>
}

function RotationChallengeReveal({ credentialId, challenge, expiresAt }: { credentialId: string; challenge: string; expiresAt: string }) {
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => {
    const hide = () => setVisible(false)
    window.addEventListener('pagehide', hide)
    return () => window.removeEventListener('pagehide', hide)
  }, [])
  if (!visible) return <div className="credential-challenge" role="status"><h3>Rotation challenge hidden</h3><p className="subtle">The challenge cannot be shown again. Begin a new rotation if the connector did not receive it.</p></div>
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ credentialId, challenge }))
      setCopied(true); setCopyError(false)
    } catch { setCopyError(true) }
  }
  return <div className="credential-challenge" aria-labelledby="rotation-challenge-title">
    <p className="eyebrow">One-time confirmation</p>
    <h3 id="rotation-challenge-title">Confirm the new key</h3>
    <p>This challenge is shown only in this browser view. Send it to the connector, then sign this challenge with the new private key and confirm through the existing connector proof endpoint.</p>
    {copyError ? <p role="alert" className="field-error">Challenge was not copied. Select the values and copy them manually.</p> : null}
    <dl><div><dt>Credential ID</dt><dd><code>{credentialId}</code></dd></div><div><dt>Challenge</dt><dd><code className="credential-challenge-value">{challenge}</code></dd></div><div><dt>Expires</dt><dd><time dateTime={expiresAt}>{formatDate(expiresAt)}</time></dd></div></dl>
    <div className="form-actions credential-actions"><Button type="button" onClick={copy}>{copied ? 'Challenge copied' : 'Copy challenge'}</Button><Button type="button" variant="secondary" onClick={() => setVisible(false)}>Hide challenge</Button></div>
  </div>
}

function healthLabel(health: ApplicationCredentialInventoryRow['health']): string {
  return health === 'OVERLAP' ? 'Overlap' : health.charAt(0) + health.slice(1).toLocaleLowerCase('en')
}

function healthTone(health: ApplicationCredentialInventoryRow['health']): BadgeTone {
  if (health === 'ACTIVE') return 'success'
  if (health === 'OVERLAP' || health === 'PENDING') return 'warning'
  if (health === 'REVOKED') return 'danger'
  return 'neutral'
}

function shortThumbprint(value: string): string { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value }
function formatDate(value: string): string { return `${date.format(new Date(value))} UTC` }
