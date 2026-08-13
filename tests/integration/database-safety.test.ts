import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireTestDatabaseUrl } from '@/tests/integration/helpers/database'

const originalDatabaseUrl = process.env.DATABASE_URL
const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL

afterEach(() => {
  vi.resetModules()
  restoreEnvironmentVariable('DATABASE_URL', originalDatabaseUrl)
  restoreEnvironmentVariable('TEST_DATABASE_URL', originalTestDatabaseUrl)
})

describe('test database URL guard', () => {
  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-url'],
    ['non-test database', 'postgresql://user:password@localhost/support'],
    ['unmarked test database', 'postgresql://user:password@localhost/support_test'],
  ])('rejects a %s TEST_DATABASE_URL without replacing DATABASE_URL', (_, testDatabaseUrl) => {
    process.env.DATABASE_URL = 'postgresql://user:password@localhost/production'
    restoreEnvironmentVariable('TEST_DATABASE_URL', testDatabaseUrl)

    expect(requireTestDatabaseUrl).toThrow(
      'TEST_DATABASE_URL must use a database ending in _test and include support_test=1',
    )
    expect(process.env.DATABASE_URL).toBe('postgresql://user:password@localhost/production')
  })

  it('accepts an explicitly marked test database and assigns DATABASE_URL', () => {
    const testDatabaseUrl =
      'postgresql://user:password@localhost/support_test?support_test=1'
    process.env.TEST_DATABASE_URL = testDatabaseUrl
    delete process.env.DATABASE_URL

    expect(requireTestDatabaseUrl()).toBe(testDatabaseUrl)
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl)
  })
})

it('imports the database driver without DATABASE_URL and defers failure until pool access', async () => {
  delete process.env.DATABASE_URL
  vi.resetModules()

  const { getDbPool } = await import('@/lib/db')

  expect(() => getDbPool()).toThrow('DATABASE_URL is not configured')
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
