'use server'

import { revalidatePath } from 'next/cache'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { hashPassword } from '@/lib/auth/password'
import {
  createSupportUser,
  deleteSupportUser,
  getPublicSupportUserById,
  updateSupportUser,
} from '@/lib/auth/users'
import { hasDatabaseUrl } from '@/lib/db'

const USERS_ROUTE = '/users' as Route

const roleSchema = z.enum(['ADMIN', 'SUPPORT'])
const statusSchema = z.enum(['ACTIVE', 'DISABLED'])

const userFormSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  name: z.string().min(1).max(160).transform((value) => value.trim()),
  role: roleSchema,
  status: statusSchema,
  password: z.string().max(1000).optional(),
})

function parseUserForm(formData: FormData, requirePassword: boolean) {
  const raw = {
    email: String(formData.get('email') ?? ''),
    name: String(formData.get('name') ?? ''),
    role: String(formData.get('role') ?? 'SUPPORT'),
    status: String(formData.get('status') ?? 'ACTIVE'),
    password: String(formData.get('password') ?? ''),
  }

  const parsed = userFormSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('Invalid user form data')
  }

  const password = parsed.data.password?.trim() ?? ''
  if (requirePassword && password.length < 12) {
    throw new Error('New users need a password of at least 12 characters')
  }

  if (!requirePassword && password && password.length < 12) {
    throw new Error('Replacement passwords need at least 12 characters')
  }

  return { ...parsed.data, password }
}

function assertDatabaseConfigured() {
  if (!hasDatabaseUrl()) {
    throw new Error('DATABASE_URL is required to manage support users')
  }
}

export async function createUserAction(formData: FormData) {
  await requireAdminUser()
  assertDatabaseConfigured()

  const data = parseUserForm(formData, true)
  await createSupportUser({
    email: data.email,
    name: data.name,
    role: data.role,
    status: data.status,
    passwordHash: await hashPassword(data.password),
  })

  revalidatePath('/users')
  redirect(USERS_ROUTE)
}

export async function updateUserAction(id: string, formData: FormData) {
  const currentUser = await requireAdminUser()
  assertDatabaseConfigured()

  const data = parseUserForm(formData, false)
  if (currentUser.id === id && data.status !== 'ACTIVE') {
    throw new Error('You cannot disable your own account')
  }

  await updateSupportUser(id, {
    email: data.email,
    name: data.name,
    role: data.role,
    status: data.status,
    passwordHash: data.password ? await hashPassword(data.password) : undefined,
  })

  revalidatePath('/users')
  revalidatePath(`/users/${id}/edit`)
  redirect(USERS_ROUTE)
}

export async function deleteUserAction(id: string) {
  const currentUser = await requireAdminUser()
  assertDatabaseConfigured()

  if (currentUser.id === id) {
    throw new Error('You cannot delete your own account')
  }

  const user = await getPublicSupportUserById(id)
  if (!user) return

  await deleteSupportUser(id)
  revalidatePath('/users')
}
