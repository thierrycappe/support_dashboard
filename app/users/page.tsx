import Link from 'next/link'
import type { Route } from 'next'
import { Edit, Trash2, UserPlus } from 'lucide-react'
import AppShell from '@/components/AppShell'
import { deleteUserAction } from '@/app/users/actions'
import { requireAdminUser } from '@/lib/auth/guards'
import { listSupportUsers } from '@/lib/auth/users'
import { hasDatabaseUrl } from '@/lib/db'

export const dynamic = 'force-dynamic'

const NEW_USER_ROUTE = '/users/new' as Route

function formatDate(value: Date | null): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

export default async function UsersPage() {
  const currentUser = await requireAdminUser()
  const databaseConfigured = hasDatabaseUrl()
  const users = databaseConfigured ? await listSupportUsers() : []

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Support users</h1>
          <p className="subtle">
            Create and manage the people who can work the support queue.
          </p>
        </div>
        <Link className="button" href={NEW_USER_ROUTE}>
          <UserPlus size={18} aria-hidden="true" />
          New user
        </Link>
      </div>

      {!databaseConfigured && (
        <div className="setup-box">
          <strong>Database not configured.</strong> Add `DATABASE_URL` before
          managing support users.
        </div>
      )}

      <section className="panel">
        <div className="panel-body">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isCurrentUser = currentUser.id === user.id
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                      <div className="subtle">{user.email}</div>
                    </td>
                    <td>
                      <span className="badge">{user.role}</span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          user.status === 'DISABLED' ? 'badge-urgent' : ''
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td>{formatDate(user.lastLoginAt)}</td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="icon-button"
                          href={`/users/${user.id}/edit` as Route}
                          aria-label={`Edit ${user.name}`}
                          title="Edit user"
                        >
                          <Edit size={16} aria-hidden="true" />
                        </Link>
                        {!isCurrentUser && (
                          <form action={deleteUserAction.bind(null, user.id)}>
                            <button
                              className="icon-button icon-button-danger"
                              type="submit"
                              aria-label={`Delete ${user.name}`}
                              title="Delete user"
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="subtle">
                    No support users have been created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  )
}
