import AppShell from '@/components/AppShell'
import { createUserAction } from '@/app/users/actions'
import UserForm from '@/app/users/UserForm'
import { requireAdminUser } from '@/lib/auth/guards'

export const dynamic = 'force-dynamic'

export default async function NewUserPage() {
  await requireAdminUser()

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>New support user</h1>
          <p className="subtle">
            Create a login for someone who can help process support tickets.
          </p>
        </div>
      </div>
      <section className="panel form-panel">
        <div className="panel-body">
          <UserForm action={createUserAction} />
        </div>
      </section>
    </AppShell>
  )
}
