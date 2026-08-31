import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exportJWK, generateKeyPair } from 'jose'
import { buildSupportE2eEnvironment } from './environment'
import { SUPPORT_E2E_PROVIDER_IP } from './container-launcher'

const databaseUrl = approvedTestDatabaseUrl()
const migrationEnvironment = buildSupportE2eEnvironment(process.env, { DATABASE_URL: databaseUrl })
const migration = spawnSync('node_modules/.bin/drizzle-kit', ['push', '--force'], {
  cwd: process.cwd(), env: migrationEnvironment, stdio: 'inherit',
})
if (migration.status !== 0) process.exit(migration.status ?? 1)

const portalKeys = await generateKeyPair('EdDSA', { extractable: true })
const pullFixture = await startPullProvider()
const legacyTokenKey = `SUPPORT_TOWER_INGEST_TOKEN_${pullFixture.appSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
const port = process.env.PORT || '3000'
const server = spawn('node_modules/.bin/next', ['dev', '--hostname', '0.0.0.0', '--port', port], {
  cwd: process.cwd(),
  env: buildSupportE2eEnvironment(process.env, {
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: randomBytes(32).toString('base64url'),
    SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(await exportJWK(portalKeys.privateKey)),
    SUPPORT_TOWER_PUBLIC_URL: 'https://support.e2e.test',
    [legacyTokenKey]: 'task22-fictional-legacy-token',
    SUPPORT_TOWER_SOURCE_APP_PULL_JSON: JSON.stringify({
      [pullFixture.appSlug]: { url: `https://${SUPPORT_E2E_PROVIDER_IP}/tickets`, token: 'fictional-pull-token' },
    }),
    CRON_SECRET: 'task22-fictional-cron-secret',
    NODE_EXTRA_CA_CERTS: pullFixture.caCertificate,
  }),
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  pullFixture.server.close()
  rmSync(pullFixture.certificateDirectory, { recursive: true, force: true })
  server.kill(signal)
})
server.on('exit', (code) => {
  pullFixture.server.close()
  rmSync(pullFixture.certificateDirectory, { recursive: true, force: true })
  process.exit(code ?? 0)
})

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

async function startPullProvider(): Promise<{
  appSlug: string
  externalId: string
  caCertificate: string
  certificateDirectory: string
  server: ReturnType<typeof createServer>
}> {
  if (process.env.SUPPORT_E2E_CONTAINERIZED !== '1') throw new Error('Browser server must run in its isolated container')
  const appSlug = `task22-pull-${crypto.randomUUID()}`
  const externalId = `task22-pulled-${crypto.randomUUID()}`
  const certificateDirectory = await mkdtemp(join(tmpdir(), 'support-e2e-cert-'))
  let server: ReturnType<typeof createServer> | undefined
  try {
    const caKey = join(certificateDirectory, 'ca-key.pem')
    const caCertificate = join(certificateDirectory, 'ca.pem')
    const serverKey = join(certificateDirectory, 'server-key.pem')
    const serverRequest = join(certificateDirectory, 'server.csr')
    const serverCertificate = join(certificateDirectory, 'server.pem')
    const extensions = join(certificateDirectory, 'extensions.cnf')
    await writeFile(extensions, [
      'basicConstraints=CA:FALSE',
      `subjectAltName=IP:${SUPPORT_E2E_PROVIDER_IP}`,
      'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      '',
    ].join('\n'), { mode: 0o600 })
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Support E2E CA', '-keyout', caKey, '-out', caCertificate])
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${SUPPORT_E2E_PROVIDER_IP}`, '-keyout', serverKey, '-out', serverRequest])
    openssl(['x509', '-req', '-days', '1', '-in', serverRequest, '-CA', caCertificate, '-CAkey', caKey, '-CAcreateserial', '-extfile', extensions, '-out', serverCertificate])
    const { readFile } = await import('node:fs/promises')
    server = createServer({ key: await readFile(serverKey), cert: await readFile(serverCertificate) }, (request, response) => {
      if (request.url !== '/tickets' || request.headers.authorization !== 'Bearer fictional-pull-token') {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ tickets: [legacyPayload(appSlug, externalId)] }))
    })
    const pullServer = server
    await new Promise<void>((resolveListen, reject) => pullServer.listen(443, '0.0.0.0', resolveListen).once('error', reject))
    await writeFile(resolve(process.cwd(), 'playwright/.runtime/source-pull.json'), JSON.stringify({ appSlug, externalId }), { mode: 0o600 })
    return { appSlug, externalId, caCertificate, certificateDirectory, server: pullServer }
  } catch (error) {
    server?.close()
    rmSync(certificateDirectory, { recursive: true, force: true })
    throw error
  }
}

function openssl(args: string[]): void {
  const result = spawnSync('openssl', args, { stdio: 'ignore' })
  if (result.status !== 0) throw new Error('Failed to generate browser test certificate')
}

function legacyPayload(appSlug: string, externalId: string) {
  const now = new Date().toISOString()
  return { app: { slug: appSlug, name: 'E2E legacy', environment: 'test' }, ticket: {
    externalId, kind: 'BUG', status: 'NEW', priority: 'HIGH', title: 'Full pull durable delivery',
    description: 'Fictional legacy E2E description', remoteCreatedAt: now, remoteUpdatedAt: now, lastStatusChangeAt: now,
  } }
}
