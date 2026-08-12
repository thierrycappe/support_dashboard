'use client'

import { useActionState, useState } from 'react'
import Button from '@/components/ui/Button'
import FieldError from '@/components/ui/FieldError'
import type { EnrollmentActionState } from '@/app/apps/actions'
import InvitationReveal from './InvitationReveal'

type Owner = { id: string; name: string; email: string }
type Action = (state: EnrollmentActionState, formData: FormData) => Promise<EnrollmentActionState>

export default function EnrollmentFlow({ owners, action }: { owners: Owner[]; action: Action }) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as EnrollmentActionState)
  const [step, setStep] = useState(0)
  const [values, setValues] = useState({ name: '', slug: '', baseUrl: '', environment: 'production', ownerIds: [] as string[], minimumPriority: 'MEDIUM', urgentCentralCopy: true, fallbackToCentral: true })
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  if (state.status === 'created') return <><StepList current={3} /><div className="panel"><div className="panel-body"><InvitationReveal {...state} /></div></div></>
  const errors = state.status === 'error' ? state.fieldErrors : {}
  const next = () => {
    if (step === 0) {
      const found: Record<string, string> = {}
      if (!values.name.trim()) found.name = 'Enter an application name, then continue.'
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) found.slug = 'Use lowercase letters, numbers, and single hyphens.'
      try { if (new URL(values.baseUrl).protocol !== 'https:') throw new Error() } catch { found.baseUrl = 'Enter a complete HTTPS application URL.' }
      if (Object.keys(found).length) return setLocalErrors(found)
    }
    if (step === 1 && values.ownerIds.length === 0) return setLocalErrors({ ownerIds: 'Select at least one owner, then continue.' })
    setLocalErrors({}); setStep((current) => Math.min(2, current + 1))
  }
  return <><StepList current={step} /><form className="panel" action={formAction}><div className="panel-body form">
    {state.status === 'error' ? <p role="alert" className="field-error">{state.message}</p> : null}
    {step === 0 ? <section aria-labelledby="application-step"><p className="eyebrow">Step 1 of 4</p><h2 id="application-step">Application</h2><p className="subtle">Record the identity the connector will use. The stable slug cannot change after enrollment.</p>
      <Field label="Application name" name="name" value={values.name} error={localErrors.name ?? errors.name?.[0]} onChange={(name) => setValues({ ...values, name })} />
      <Field label="Stable slug" name="slug" value={values.slug} error={localErrors.slug ?? errors.slug?.[0]} onChange={(slug) => setValues({ ...values, slug })} />
      <Field label="Application URL" name="baseUrl" type="url" value={values.baseUrl} error={localErrors.baseUrl ?? errors.baseUrl?.[0]} onChange={(baseUrl) => setValues({ ...values, baseUrl })} />
      <div className="field"><label htmlFor="environment">Environment</label><select id="environment" value={values.environment} onChange={(event) => setValues({ ...values, environment: event.target.value })}><option value="production">Production</option><option value="staging">Staging</option><option value="test">Test</option></select></div>
      <div className="form-actions"><Button type="button" onClick={next}>Continue to owners</Button></div>
    </section> : null}
    {step === 1 ? <section aria-labelledby="owners-step"><p className="eyebrow">Step 2 of 4</p><h2 id="owners-step">Owners</h2><p className="subtle">Owners receive technical responsibility for escalations from this application.</p>
      <fieldset className="enrollment-owner-list"><legend>Application owners</legend>{owners.map((owner) => <label key={owner.id}><input type="checkbox" checked={values.ownerIds.includes(owner.id)} onChange={(event) => setValues({ ...values, ownerIds: event.target.checked ? [...values.ownerIds, owner.id] : values.ownerIds.filter((id) => id !== owner.id) })} /><span>{owner.name}<span className="subtle"> {owner.email}</span></span></label>)}</fieldset>
      {localErrors.ownerIds || errors.ownerIds?.[0] ? <FieldError>{localErrors.ownerIds ?? errors.ownerIds?.[0]}</FieldError> : null}
      <div className="form-actions enrollment-actions"><Button type="button" variant="secondary" onClick={() => setStep(0)}>Back to application</Button><Button type="button" onClick={next}>Continue to alerts</Button></div>
    </section> : null}
    {step === 2 ? <section aria-labelledby="alerts-step"><p className="eyebrow">Step 3 of 4</p><h2 id="alerts-step">Alerts</h2><p className="subtle">Set the notification policy used when business-approved feedback is escalated.</p>
      <div className="field"><label htmlFor="minimumPriority">Minimum priority</label><select id="minimumPriority" value={values.minimumPriority} onChange={(event) => setValues({ ...values, minimumPriority: event.target.value })}>{['LOW','MEDIUM','HIGH','URGENT'].map((priority) => <option key={priority}>{priority}</option>)}</select></div>
      <label><input type="checkbox" checked={values.urgentCentralCopy} onChange={(event) => setValues({ ...values, urgentCentralCopy: event.target.checked })} /> Copy urgent escalations to the central team</label>
      <label><input type="checkbox" checked={values.fallbackToCentral} onChange={(event) => setValues({ ...values, fallbackToCentral: event.target.checked })} /> Use the central team when no owner channel is available</label>
      <div className="form-actions enrollment-actions"><Button type="button" variant="secondary" onClick={() => setStep(1)}>Back to owners</Button><Button type="submit" loading={pending}>Create invitation</Button></div>
    </section> : null}
    <input type="hidden" name="name" value={values.name} /><input type="hidden" name="slug" value={values.slug} /><input type="hidden" name="baseUrl" value={values.baseUrl} /><input type="hidden" name="environment" value={values.environment} />{values.ownerIds.map((id) => <input key={id} type="hidden" name="ownerIds" value={id} />)}<input type="hidden" name="minimumPriority" value={values.minimumPriority} />{values.urgentCentralCopy ? <input type="hidden" name="urgentCentralCopy" value="on" /> : null}{values.fallbackToCentral ? <input type="hidden" name="fallbackToCentral" value="on" /> : null}
  </div></form></>
}

function StepList({ current }: { current: number }) { return <nav aria-label="Enrollment progress"><ol className="enrollment-steps">{['Application','Owners','Alerts','Invitation'].map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined}>{label}</li>)}</ol></nav> }
function Field({ label, name, type='text', value, error, onChange }: { label: string; name: string; type?: string; value: string; error?: string; onChange: (value: string) => void }) { const id = `enrollment-${name}`; const errorId = `${id}-error`; return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />{error ? <FieldError id={errorId}>{error}</FieldError> : null}</div> }
