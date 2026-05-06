import { redirect } from 'next/navigation'
import { auth } from '@/auth'

export async function requireAuthenticatedUser() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  return session.user
}

export async function requireAdminUser() {
  const user = await requireAuthenticatedUser()
  if (user.role !== 'ADMIN') redirect('/')
  return user
}
