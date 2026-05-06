import { notFound } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { updateUserAction } from '@/app/users/actions'
import UserForm from '@/app/users/UserForm'
import { requireAdminUser } from '@/lib/auth/guards'
import { getPublicSupportUserById } from '@/lib/auth/users'

export const dynamic = 'force-dynamic'

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminUser()
  const { id } = await params
  const user = await getPublicSupportUserById(id)
  if (!user) notFound()

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Edit support user</h1>
          <p className="subtle">{user.email}</p>
        </div>
      </div>
      <section className="panel form-panel">
        <div className="panel-body">
          <UserForm action={updateUserAction.bind(null, user.id)} user={user} />
        </div>
      </section>
    </AppShell>
  )
}
