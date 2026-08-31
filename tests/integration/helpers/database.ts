function isApprovedTestDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const databaseName = decodeURIComponent(url.pathname)
      .split('/')
      .filter(Boolean)
      .at(-1)

    return databaseName?.endsWith('_test') === true && url.searchParams.get('support_test') === '1'
  } catch {
    return false
  }
}

export function requireTestDatabaseUrl(): string {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL
  if (!testDatabaseUrl || !isApprovedTestDatabaseUrl(testDatabaseUrl)) {
    throw new Error(
      'TEST_DATABASE_URL must use a database ending in _test and include support_test=1',
    )
  }

  process.env.DATABASE_URL = testDatabaseUrl
  return testDatabaseUrl
}
