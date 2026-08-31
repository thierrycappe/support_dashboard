'use client'

import { useActionState } from 'react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import type { ActionState } from '@/app/teams/actions'

type Group = { id: string; name: string; status: 'ACTIVE' | 'DISABLED'; isCentralFallback: boolean; members: Array<{ id: string; label: string; supportUserId: string | null; recipientRef: string | null; role: string; status: 'ACTIVE' | 'DISABLED' }> }
type SupportUser = { id: string; name: string; email: string; status?: 'ACTIVE' | 'DISABLED' }
type GroupAction = (state: ActionState, formData: FormData) => Promise<ActionState>

export default function GroupEditor({ action, membershipAction, groups, users }: { action: GroupAction; membershipAction: GroupAction; groups: Group[]; users: SupportUser[] }) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as ActionState)
  return <section className="operations-section" aria-labelledby="groups-title"><div className="queue-heading"><h2 id="groups-title">Technical groups</h2><span className="subtle">Ownership and fallback routes</span></div>
    <div className="group-ledger">{groups.map((group) => <article className="group-row" key={group.id}><div><strong>{group.name}</strong><div className="group-badges"><Badge tone={group.status === 'ACTIVE' ? 'success' : 'neutral'}>{label(group.status)}</Badge>{group.isCentralFallback ? <Badge tone="info">Central fallback</Badge> : null}</div></div><div className="group-members">{group.members.length ? group.members.map((member) => <span key={member.id}>{member.label} · {member.role}</span>) : <span className="subtle">Members appear when a support user or recipient is assigned.</span>}</div><GroupMembershipForm group={group} users={users} action={membershipAction} /></article>)}{groups.length === 0 ? <p className="subtle">Technical groups appear when an administrator establishes an ownership route.</p> : null}</div>
    <form className="inline-operation-form" action={formAction}><div className="field"><label htmlFor="technical-group-name">Technical group name</label><input id="technical-group-name" name="name" required /></div><label className="check-field"><input type="checkbox" name="isCentralFallback" /> Use as central fallback</label><input type="hidden" name="status" value="ACTIVE" /><Button type="submit" loading={pending}>Create technical group</Button>{state.status !== 'idle' ? <span role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'field-error' : 'action-confirmation'}>{state.message}</span> : null}</form>
  </section>
}

function GroupMembershipForm({ group, users, action }: { group: Group; users: SupportUser[]; action: GroupAction }) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as ActionState)
  const selected = new Set(group.members.flatMap((member) => member.supportUserId ? [member.supportUserId] : []))
  const recipients = group.members.flatMap((member) => member.recipientRef ? [member.recipientRef] : []).join(', ')
  return <form className="group-membership-form" action={formAction}><input type="hidden" name="groupId" value={group.id} />
    <fieldset className="membership-options"><legend>Support members</legend>{users.filter((user) => user.status !== 'DISABLED' || selected.has(user.id)).map((user) => <label className="check-field" key={user.id}><input type="checkbox" name="memberIds" value={user.id} defaultChecked={selected.has(user.id)} /><span className="membership-identity"><span className="membership-name">{user.name}</span><span className="membership-email subtle">{user.email}</span></span></label>)}</fieldset>
    <div className="field"><label htmlFor={`recipient-refs-${group.id}`}>External recipient references</label><input id={`recipient-refs-${group.id}`} name="recipientRefs" defaultValue={recipients} placeholder="partner-oncall, vendor-escalation" /></div>
    <Button type="submit" variant="secondary" loading={pending}>Save group members</Button>
    {state.status !== 'idle' ? <span role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'field-error' : 'action-confirmation'}>{state.message}</span> : null}
  </form>
}
function label(value: string): string { return value.charAt(0) + value.slice(1).toLocaleLowerCase('en') }
