import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  verifyLegacyPlaintextPassword,
  verifyPassword,
} from '@/lib/auth/password'

describe('admin password hashing', () => {
  it('hashes and verifies an admin password with scrypt', async () => {
    const encodedHash = await hashPassword('correct horse battery staple', {
      cost: 1024,
    })

    expect(encodedHash).toMatch(/^scrypt-v1\$/)
    expect(await verifyPassword('correct horse battery staple', encodedHash)).toBe(
      true,
    )
    expect(await verifyPassword('wrong password', encodedHash)).toBe(false)
  })

  it('compares legacy plaintext passwords without exposing direct equality', async () => {
    expect(await verifyLegacyPlaintextPassword('admin', 'admin')).toBe(true)
    expect(await verifyLegacyPlaintextPassword('admin', 'different')).toBe(false)
  })
})
