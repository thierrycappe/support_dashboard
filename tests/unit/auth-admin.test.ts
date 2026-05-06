import { describe, expect, it } from 'vitest'
import {
  authorizeAdminCredentials,
  getAllowedAdminEmails,
  getRequestIp,
  normalizeLoginIdentifier,
  verifyAdminPassword,
} from '@/lib/auth/admin'
import { hashPassword } from '@/lib/auth/password'

describe('admin credential authorization', () => {
  it('normalizes allowed admin emails from the comma-separated env var', () => {
    expect(
      getAllowedAdminEmails({
        SUPPORT_DASHBOARD_ADMIN_EMAILS:
          'THIERRY@example.com, second-admin@example.com ',
        SUPPORT_DASHBOARD_ADMIN_EMAIL: 'legacy@example.com',
      }),
    ).toEqual(['thierry@example.com', 'second-admin@example.com'])
  })

  it('falls back to the legacy single admin email env var', () => {
    expect(
      getAllowedAdminEmails({
        SUPPORT_DASHBOARD_ADMIN_EMAIL: 'LEGACY@example.com',
      }),
    ).toEqual(['legacy@example.com'])
  })

  it('normalizes login identifiers', () => {
    expect(normalizeLoginIdentifier(' Thierry@Example.COM ')).toBe(
      'thierry@example.com',
    )
  })

  it('extracts the first forwarded IP address', () => {
    const request = new Request('https://support.example.com/login', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 198.51.100.20',
      },
    })

    expect(getRequestIp(request)).toBe('203.0.113.10')
  })

  it('requires a password hash in production', async () => {
    expect(
      await verifyAdminPassword('admin', {
        NODE_ENV: 'production',
        SUPPORT_DASHBOARD_ADMIN_PASSWORD: 'admin',
      }),
    ).toBe(false)
  })

  it('authorizes a configured admin with a hashed password', async () => {
    const passwordHash = await hashPassword('admin-password', { cost: 1024 })
    const user = await authorizeAdminCredentials(
      {
        email: 'Thierry@example.com',
        password: 'admin-password',
      },
      undefined,
      {
        NODE_ENV: 'production',
        SUPPORT_DASHBOARD_ADMIN_EMAILS: 'thierry@example.com',
        SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH: passwordHash,
      },
    )

    expect(user).toEqual({
      id: 'admin:thierry@example.com',
      email: 'thierry@example.com',
      name: 'Support Tower admin',
    })
  })

  it('rejects a correct password for an unauthorized email', async () => {
    const passwordHash = await hashPassword('admin-password', { cost: 1024 })
    const user = await authorizeAdminCredentials(
      {
        email: 'intruder@example.com',
        password: 'admin-password',
      },
      undefined,
      {
        NODE_ENV: 'production',
        SUPPORT_DASHBOARD_ADMIN_EMAILS: 'thierry@example.com',
        SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH: passwordHash,
      },
    )

    expect(user).toBeNull()
  })
})
