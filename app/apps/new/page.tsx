import Link from 'next/link'
import AppShell from '@/components/AppShell'
import EnrollmentFlow from '@/components/enrollment/EnrollmentFlow'
import { getActiveApplicationOwners } from '@/lib/apps/queries'
import { requireAdminUser } from '@/lib/auth/guards'
import { createEnrollmentAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function NewApplicationPage() {
  await requireAdminUser()
  const owners = await getActiveApplicationOwners()
  return <AppShell><header className="topbar"><div><p className="eyebrow">Application enrollment</p><h1>Enroll application</h1><p className="subtle">Create ownership and alert policy before issuing a one-time invitation.</p></div><Link className="ui-button ui-button-secondary" href="/apps">Cancel enrollment</Link></header><EnrollmentFlow owners={owners} action={createEnrollmentAction} /></AppShell>
}
