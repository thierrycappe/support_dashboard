'use client'

import { useActionState } from 'react'
import Badge, { type BadgeTone } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import FieldError from '@/components/ui/FieldError'
import type { ActionState } from '@/app/teams/actions'

type Group = { id: string; name: string }
type Channel = { id: string; groupId: string; name: string; type: 'EMAIL' | 'PUSHOVER' | 'WEBHOOK'; status: 'ACTIVE' | 'DISABLED' | 'UNHEALTHY'; destination: string; includeReporterContext: boolean; lastSuccessAt: Date | null; lastFailureAt: Date | null }
type ChannelAction = (state: ActionState, formData: FormData) => Promise<ActionState>

export default function ChannelEditor({ action, groups, channels }: { action: ChannelAction; groups: Group[]; channels: Channel[] }) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as ActionState)
  const configError = state.status === 'error' ? state.fieldErrors?.config?.[0] : undefined
  return <section className="operations-section" aria-labelledby="channels-title"><div className="queue-heading"><h2 id="channels-title">Alert channels</h2><span className="subtle">Destinations stay redacted</span></div>
    <div className="channel-ledger">{channels.map((channel) => <article key={channel.id} className="channel-row"><div><strong>{channel.name}</strong><span className="table-secondary">{channel.destination}</span></div><Badge tone={channelTone(channel.status)}>{label(channel.status)}</Badge><span>{channel.type}</span><span className="subtle">{channel.lastFailureAt ? 'Last delivery needs review' : channel.lastSuccessAt ? 'Delivery healthy' : 'No delivery recorded'}</span></article>)}{channels.length === 0 ? <p className="subtle">Channels appear after a technical group receives a delivery destination.</p> : null}</div>
    <form className="channel-form" action={formAction}><div className="field"><label htmlFor="channel-group">Technical group</label><select id="channel-group" name="groupId" required defaultValue=""><option disabled value="">Select group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div><div className="field"><label htmlFor="channel-name">Alert channel name</label><input id="channel-name" name="name" required /></div><div className="field"><label htmlFor="channel-type">Channel type</label><select id="channel-type" name="type" defaultValue="EMAIL"><option>EMAIL</option><option>PUSHOVER</option><option>WEBHOOK</option></select></div><div className="field"><label htmlFor="channel-config">Configuration package</label><textarea id="channel-config" name="config" required aria-invalid={configError ? true : undefined} aria-describedby={configError ? 'channel-config-error' : undefined} placeholder='{"to":["ops@example.test"]}' />{configError ? <FieldError id="channel-config-error">{configError}</FieldError> : null}</div><label className="check-field"><input type="checkbox" name="includeReporterContext" /> Include reporter context</label><input type="hidden" name="status" value="ACTIVE" /><Button type="submit" loading={pending}>Create alert channel</Button>{state.status !== 'idle' ? <span role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'field-error' : 'action-confirmation'}>{state.message}</span> : null}</form>
  </section>
}
function label(value: string): string { return value.charAt(0) + value.slice(1).toLocaleLowerCase('en') }
function channelTone(status: Channel['status']): BadgeTone { return status === 'UNHEALTHY' ? 'danger' : status === 'ACTIVE' ? 'success' : 'neutral' }
