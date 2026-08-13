import AppShell from '@/components/AppShell'
import GroupEditor from '@/components/teams/GroupEditor'
import ChannelEditor from '@/components/teams/ChannelEditor'
import { createAlertChannelAction, createTechnicalGroupAction, replaceAlertChannelSecretAction, setTechnicalGroupMembersAction } from '@/app/teams/actions'
import { requireAdminUser } from '@/lib/auth/guards'
import { listSupportUsers } from '@/lib/auth/users'
import { hasDatabaseUrl } from '@/lib/db'
import { listTeamOperations } from '@/lib/routing/groups'
import InlineNotice from '@/components/ui/InlineNotice'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  await requireAdminUser()
  const configured = hasDatabaseUrl()
  const [operations, users] = configured
    ? await Promise.all([listTeamOperations(), listSupportUsers()])
    : [{ groups: [], channels: [] }, []]
  return <AppShell><header className="topbar"><div><p className="eyebrow">Routing administration</p><h1>Teams</h1><p className="subtle">Technical ownership, fallback coverage, and delivery destinations.</p></div></header>
    {!configured ? <InlineNotice tone="warning" title="Team data is temporarily unavailable">Configure the application data connection, then reload this view.</InlineNotice> : null}
    <GroupEditor action={createTechnicalGroupAction} membershipAction={setTechnicalGroupMembersAction} groups={operations.groups} users={users} />
    <ChannelEditor action={createAlertChannelAction} replaceAction={replaceAlertChannelSecretAction} groups={operations.groups.map(({ id, name }) => ({ id, name }))} channels={operations.channels} />
  </AppShell>
}
