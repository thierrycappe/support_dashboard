import Link from 'next/link'
import type { Route } from 'next'
import type { PublicSupportUser } from '@/lib/auth/users'

const USERS_ROUTE = '/users' as Route

export default function UserForm({
  action,
  user,
}: {
  action: (formData: FormData) => Promise<void>
  user?: PublicSupportUser
}) {
  const isEditing = Boolean(user)

  return (
    <form className="form" action={action}>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={user?.name}
          required
          autoComplete="name"
        />
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={user?.email}
          required
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label htmlFor="role">Role</label>
        <select id="role" name="role" defaultValue={user?.role ?? 'SUPPORT'}>
          <option value="ADMIN">Admin</option>
          <option value="SUPPORT">Support</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={user?.status ?? 'ACTIVE'}>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="password">
          {isEditing ? 'New password' : 'Password'}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={12}
          required={!isEditing}
          autoComplete="new-password"
        />
        {isEditing && (
          <div className="subtle">Leave blank to keep the current password.</div>
        )}
      </div>
      <div className="form-actions">
        <button className="button" type="submit">
          {isEditing ? 'Save user' : 'Create user'}
        </button>
        <Link className="button button-secondary" href={USERS_ROUTE}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
