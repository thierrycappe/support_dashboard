'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import InvitationReveal from '@/components/enrollment/InvitationReveal'
import type { ApplicationLifecycleState } from '@/app/apps/actions'

export default function ApplicationLifecycle({ app, action }: {
  app: { id: string; name: string; status: string; enrollmentStatus: string }
  action: (previous: ApplicationLifecycleState, formData: FormData) => Promise<ApplicationLifecycleState>
}) {
  const [state, submit, pending] = useActionState(action, { status: 'idle' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmationId = useId()
  const confirmation = useRef<HTMLInputElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (confirmDelete) confirmation.current?.focus()
    else if (restoreFocus.current) {
      deleteButton.current?.focus()
      restoreFocus.current = false
    }
  }, [confirmDelete])
  if (state.status === 'created') return <InvitationReveal key={state.invitationId} {...state} />
  return <form action={submit} aria-label={`Manage ${app.name}`}>
    <input type="hidden" name="appId" value={app.id} />
    {state.status === 'error' ? <p role="alert" className="field-error">{state.message}</p> : null}
    {state.status === 'success' ? <p role="status">{state.message}</p> : null}
    {confirmDelete ? <div>
      <p>Delete {app.name}? Access will be revoked and the application removed from this list. Ticket and audit history will be retained. This cannot be undone.</p>
      <label htmlFor={confirmationId}><input ref={confirmation} id={confirmationId} name="confirmed" type="checkbox" required disabled={pending} /> I confirm deletion of {app.name}</label>
      <div className="form-actions">
        <Button type="submit" name="operation" value="delete" variant="danger" loading={pending}>Confirm deletion</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => { restoreFocus.current = true; setConfirmDelete(false) }}>Cancel</Button>
      </div>
    </div> : <div className="form-actions">
      {app.enrollmentStatus === 'PENDING' && app.status === 'ACTIVE' ? <Button type="submit" name="operation" value="resubmit" variant="secondary" loading={pending}>Resubmit enrollment</Button> : null}
      <Button type="submit" name="operation" value={app.status === 'PAUSED' ? 'resume' : 'suspend'} variant="secondary" loading={pending}>{app.status === 'PAUSED' ? 'Resume application' : 'Suspend application'}</Button>
      <Button ref={deleteButton} type="button" variant="danger" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete application</Button>
    </div>}
  </form>
}
