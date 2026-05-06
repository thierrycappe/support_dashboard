'use server'

import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/auth'

export async function loginAction(formData: FormData) {
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo: '/',
    })
  } catch (error) {
    if (error instanceof AuthError) {
      redirect('/login?error=credentials')
    }
    throw error
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: '/login' })
}
