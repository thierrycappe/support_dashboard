import { nanoid } from 'nanoid'
import { asc, eq } from 'drizzle-orm'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { supportUsers, type authUserRole, type authUserStatus } from '@/lib/db/schema'

export type SupportUserRole = (typeof authUserRole.enumValues)[number]
export type SupportUserStatus = (typeof authUserStatus.enumValues)[number]

export interface SupportUser {
  id: string
  email: string
  name: string
  role: SupportUserRole
  status: SupportUserStatus
  passwordHash: string
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface PublicSupportUser {
  id: string
  email: string
  name: string
  role: SupportUserRole
  status: SupportUserStatus
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase()
}

function toPublicUser(user: SupportUser): PublicSupportUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export async function listSupportUsers(): Promise<PublicSupportUser[]> {
  if (!hasDatabaseUrl()) return []

  const rows = await getDb()
    .select()
    .from(supportUsers)
    .orderBy(asc(supportUsers.name), asc(supportUsers.email))

  return rows.map(toPublicUser)
}

export async function getSupportUserByEmail(
  email: string,
): Promise<SupportUser | null> {
  if (!hasDatabaseUrl()) return null

  const rows = await getDb()
    .select()
    .from(supportUsers)
    .where(eq(supportUsers.email, normalizeUserEmail(email)))
    .limit(1)

  return rows[0] ?? null
}

export async function getPublicSupportUserById(
  id: string,
): Promise<PublicSupportUser | null> {
  if (!hasDatabaseUrl()) return null

  const rows = await getDb()
    .select()
    .from(supportUsers)
    .where(eq(supportUsers.id, id))
    .limit(1)

  return rows[0] ? toPublicUser(rows[0]) : null
}

export async function createSupportUser(input: {
  email: string
  name: string
  role: SupportUserRole
  status: SupportUserStatus
  passwordHash: string
}): Promise<PublicSupportUser> {
  const now = new Date()
  const row = {
    id: nanoid(),
    email: normalizeUserEmail(input.email),
    name: input.name.trim(),
    role: input.role,
    status: input.status,
    passwordHash: input.passwordHash,
    createdAt: now,
    updatedAt: now,
  }

  const rows = await getDb().insert(supportUsers).values(row).returning()
  return toPublicUser(rows[0])
}

export async function updateSupportUser(
  id: string,
  input: {
    email: string
    name: string
    role: SupportUserRole
    status: SupportUserStatus
    passwordHash?: string
  },
): Promise<void> {
  await getDb()
    .update(supportUsers)
    .set({
      email: normalizeUserEmail(input.email),
      name: input.name.trim(),
      role: input.role,
      status: input.status,
      passwordHash: input.passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(supportUsers.id, id))
}

export async function updateSupportUserPassword(
  id: string,
  passwordHash: string,
): Promise<void> {
  await getDb()
    .update(supportUsers)
    .set({
      passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(supportUsers.id, id))
}

export async function deleteSupportUser(id: string): Promise<void> {
  await getDb().delete(supportUsers).where(eq(supportUsers.id, id))
}

export async function recordSupportUserLogin(id: string): Promise<void> {
  if (!hasDatabaseUrl()) return

  const now = new Date()
  await getDb()
    .update(supportUsers)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(supportUsers.id, id))
}

export async function ensureBootstrapSupportUser(input: {
  email: string
  name: string
  passwordHash: string
}): Promise<PublicSupportUser | null> {
  if (!hasDatabaseUrl()) return null

  const existing = await getSupportUserByEmail(input.email)
  if (existing) return toPublicUser(existing)

  return createSupportUser({
    email: input.email,
    name: input.name,
    role: 'ADMIN',
    status: 'ACTIVE',
    passwordHash: input.passwordHash,
  })
}
