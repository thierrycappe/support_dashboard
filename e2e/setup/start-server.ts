import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { exportJWK, generateKeyPair } from 'jose'

const databaseUrl = approvedTestDatabaseUrl()
const migration = spawnSync('node_modules/.bin/drizzle-kit', ['push', '--force'], {
  cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
})
if (migration.status !== 0) process.exit(migration.status ?? 1)

const portalKeys = await generateKeyPair('EdDSA', { extractable: true })
const port = process.env.PORT || '3000'
const server = spawn('node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', port], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: randomBytes(32).toString('base64url'),
    SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(await exportJWK(portalKeys.privateKey)),
    SUPPORT_TOWER_PUBLIC_URL: 'https://support.e2e.test',
    SUPPORT_TOWER_INGEST_TOKEN_E2E_LEGACY: 'task22-fictional-legacy-token',
  },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal))
server.on('exit', (code) => process.exit(code ?? 0))

function approvedTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (!value) throw new Error('TEST_DATABASE_URL is required for browser journeys')
  const url = new URL(value)
  const database = decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1)
  if (!database?.endsWith('_test') || url.searchParams.get('support_test') !== '1') {
    throw new Error('Browser journeys require an approved disposable test database')
  }
  return value
}
