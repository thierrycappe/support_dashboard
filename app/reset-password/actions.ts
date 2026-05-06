'use server'

import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { consumePasswordResetToken } from '@/lib/auth/password-reset'

const LOGIN_RESET_ROUTE = '/login?reset=1' as Route

function resetErrorRoute(token: string, error: string): Route {
  return `/reset-password?token=${encodeURIComponent(token)}&error=${error}` as Route
}

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  if (password !== confirmPassword) {
    redirect(resetErrorRoute(token, 'mismatch'))
  }

  const result = await consumePasswordResetToken(token, password)
  if (result !== 'success') {
    redirect(resetErrorRoute(token, result))
  }

  redirect(LOGIN_RESET_ROUTE)
}
