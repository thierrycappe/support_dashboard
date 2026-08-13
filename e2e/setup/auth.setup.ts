import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test as setup, expect } from '@playwright/test'
import { Pool } from 'pg'
import { hashPassword } from '@/lib/auth/password'

export const AUTH_FILE = resolve(process.cwd(), 'playwright/.auth/admin.json')
export const E2E_ADMIN_EMAIL = 'admin.task22@example.test'
export const E2E_ADMIN_PASSWORD = 'Task22 fictional browser password'

setup('authenticates a seeded administrator through the real login form', async ({ page }) => {
  const pool = new Pool({ connectionString: approvedTestDatabaseUrl() })
  try {
    const passwordHash = await hashPassword(E2E_ADMIN_PASSWORD, { cost: 1_024 })
    await pool.query(`
      insert into support_users (id,email,name,role,status,password_hash,created_at,updated_at)
      values ('task22-admin',$1,'Morgan Lee','ADMIN','ACTIVE',$2,now(),now())
      on conflict (email) do update set role='ADMIN',status='ACTIVE',password_hash=excluded.password_hash,updated_at=now()
    `, [E2E_ADMIN_EMAIL, passwordHash])
  } finally { await pool.end() }

  await page.goto('/login')
  await page.getByLabel('Email').fill(E2E_ADMIN_EMAIL)
  await page.getByLabel('Password').fill(E2E_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Escalations', exact: true })).toBeVisible()
  await mkdir(dirname(AUTH_FILE), { recursive: true })
  await page.context().storageState({ path: AUTH_FILE })
})

function approvedTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (!value) throw new Error('TEST_DATABASE_URL is required')
  const url = new URL(value)
  if (!url.pathname.endsWith('_test') || url.searchParams.get('support_test') !== '1') throw new Error('Unsafe browser database URL')
  return value
}
