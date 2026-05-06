import { ensureBootstrapSupportUser } from '@/lib/auth/users'

const adminEmail = (
  process.env.SUPPORT_DASHBOARD_ADMIN_EMAILS ||
  process.env.SUPPORT_DASHBOARD_ADMIN_EMAIL ||
  ''
)
  .split(',')[0]
  ?.trim()
  .toLowerCase()
const passwordHash = process.env.SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH?.trim()

if (!adminEmail || !passwordHash) {
  console.error(
    'SUPPORT_DASHBOARD_ADMIN_EMAILS and SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH are required',
  )
  process.exit(1)
}

const user = await ensureBootstrapSupportUser({
  email: adminEmail,
  name: 'Support Tower admin',
  passwordHash,
})

console.log(`Seeded admin user: ${user?.email ?? adminEmail}`)
