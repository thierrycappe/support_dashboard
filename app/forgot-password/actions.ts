'use server'

import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { requestPasswordResetEmail } from '@/lib/auth/password-reset'

const SENT_ROUTE = '/forgot-password?sent=1' as Route

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  await requestPasswordResetEmail({ email })
  redirect(SENT_ROUTE)
}
