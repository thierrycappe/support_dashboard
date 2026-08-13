import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createHttpsServer, request } from 'node:https'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose'
import { Pool } from 'pg'

type FixtureServer = { stop: () => Promise<void> }
const PROXY_REQUEST_TIMEOUT_MS = 30_000

export interface DisposableLoadFixtureCoordinator<Runtime> {
  prepare: () => Promise<Runtime>
  seed: (runtime: Runtime) => Promise<void>
  start: (runtime: Runtime) => Promise<FixtureServer>
  ready: (runtime: Runtime) => Promise<void>
  verify: (runtime: Runtime) => Promise<void>
  cleanupFixture: (runtime: Runtime) => Promise<void>
  cleanupFiles: (runtime: Runtime) => Promise<void>
}

export async function coordinateDisposableLoadFixture<Runtime>(
  coordinator: DisposableLoadFixtureCoordinator<Runtime>,
): Promise<void> {
  let runtime: Runtime | undefined
  let server: FixtureServer | undefined
  let failure: unknown
  try {
    runtime = await coordinator.prepare()
    await coordinator.seed(runtime)
    server = await coordinator.start(runtime)
    await coordinator.ready(runtime)
    await coordinator.verify(runtime)
  } catch (error) {
    failure = error
  }

  for (const cleanup of [
    () => server?.stop(),
    () => runtime === undefined ? undefined : coordinator.cleanupFixture(runtime),
    () => runtime === undefined ? undefined : coordinator.cleanupFiles(runtime),
  ]) {
    try {
      await cleanup()
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) throw failure
}

export function requireDisposableTestDatabaseUrl(
  env: Record<string, string | undefined>,
): string {
  const value = env.TEST_DATABASE_URL
  try {
    if (!value) throw new Error('missing')
    const url = new URL(value)
    const database = decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1)
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    const query = [...url.searchParams.entries()]
    const exactMarker = query.length === 1 && query[0]?.[0] === 'support_test' && query[0]?.[1] === '1'
    if (!local || !database?.endsWith('_test') || !exactMarker) {
      throw new Error('unsafe')
    }
    return value
  } catch {
    throw new Error('Disposable load verification requires a marked local test database')
  }
}

export interface FixtureIdentity {
  appId: string
  credentialId: string
  groupId: string
  channelId: string
  publicJwk: Record<string, unknown>
  publicKeyThumbprint: string
}

interface FixtureRuntime extends FixtureIdentity {
  databaseUrl: string
  privateJwk: Record<string, unknown>
  portalPrivateJwk: Record<string, unknown>
  tempDirectory: string
  certificatePath: string
  privateKeyPath: string
  appPort: number
  httpsPort: number
  baseUrl: string
}

export async function runDisposableLoadFixture(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const databaseUrl = requireDisposableTestDatabaseUrl(env)
  await coordinateDisposableLoadFixture({
    prepare: () => prepareRuntime(databaseUrl),
    seed: seedFixture,
    start: (runtime) => startPortal(runtime, env),
    ready: waitForPortal,
    verify: (runtime) => runLoadHarness(runtime, env),
    cleanupFixture,
    cleanupFiles: (runtime) => rm(runtime.tempDirectory, { recursive: true, force: true }),
  })
}

async function prepareRuntime(databaseUrl: string): Promise<FixtureRuntime> {
  runRequiredCommand('node_modules/.bin/drizzle-kit', ['push', '--force'], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  })
  const appKeys = await generateKeyPair('EdDSA', { extractable: true })
  const portalKeys = await generateKeyPair('EdDSA', { extractable: true })
  const publicJwk = await exportJWK(appKeys.publicKey) as Record<string, unknown>
  const suffix = randomUUID()
  const tempDirectory = await mkdtemp(join(tmpdir(), 'support-overhaul-load-'))
  const certificatePath = join(tempDirectory, 'localhost.crt')
  const privateKeyPath = join(tempDirectory, 'localhost.key')
  try {
    runRequiredCommand('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
      '-keyout', privateKeyPath, '-out', certificatePath, '-days', '1',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,digitalSignature,keyEncipherment',
    ], process.env)
    const appPort = await reservePort()
    const httpsPort = await reservePort()
    return {
      databaseUrl,
      appId: `load-test-${suffix}`,
      credentialId: `load-credential-${suffix}`,
      groupId: `load-group-${suffix}`,
      channelId: `load-channel-${suffix}`,
      publicJwk,
      privateJwk: await exportJWK(appKeys.privateKey) as Record<string, unknown>,
      publicKeyThumbprint: await calculateJwkThumbprint(publicJwk, 'sha256'),
      portalPrivateJwk: await exportJWK(portalKeys.privateKey) as Record<string, unknown>,
      tempDirectory,
      certificatePath,
      privateKeyPath,
      appPort,
      httpsPort,
      baseUrl: `https://localhost:${httpsPort}`,
    }
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true })
    throw error
  }
}

async function seedFixture(runtime: FixtureRuntime): Promise<void> {
  const pool = new Pool({ connectionString: runtime.databaseUrl, max: 2 })
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const statement of fixtureSeedStatements(runtime)) {
      await client.query(statement.text, statement.values)
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

export function fixtureSeedStatements(runtime: FixtureIdentity): Array<{
  text: string
  values: unknown[]
}> {
  return [
    {
      text: `
        insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
        values ($1, $2, 'ACTIVE', false, now(), now())
      `,
      values: [runtime.groupId, `Load test group ${runtime.groupId}`],
    },
    {
      text: `
        insert into source_apps
          (id, slug, name, environment, status, enrollment_status, credential_mode, technical_group_id, created_at, updated_at)
        values ($1, $1, 'Disposable load test app', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', $2, now(), now())
      `,
      values: [runtime.appId, runtime.groupId],
    },
    {
      text: `
        insert into app_credentials
          (id, source_app_id, public_jwk, public_key_thumbprint, status, valid_from, created_at)
        values ($1, $2, $3::jsonb, $4, 'ACTIVE', now(), now())
      `,
      values: [
        runtime.credentialId,
        runtime.appId,
        JSON.stringify(runtime.publicJwk),
        runtime.publicKeyThumbprint,
      ],
    },
    {
      // No channel keyring is passed to the child server. This active database
      // target therefore produces a permanent CONFIGURATION_INVALID attempt
      // without allowing any provider request to leave the test process.
      text: `
        insert into notification_channels
          (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag,
           key_version, recipient_display, redacted_destination, include_reporter_context, created_at, updated_at)
        values ($1, $2, 'No-egress load sink', 'WEBHOOK', 'ACTIVE', 'fixture', 'fixture', 'fixture',
                1, 'No-egress test sink', 'no provider destination', false, now(), now())
      `,
      values: [runtime.channelId, runtime.groupId],
    },
  ]
}

async function startPortal(
  runtime: FixtureRuntime,
  inheritedEnv: Record<string, string | undefined>,
): Promise<FixtureServer> {
  const processes = buildPortalProcesses(runtime)
  const portalEnvironment = buildPortalEnvironment(inheritedEnv, {
    databaseUrl: runtime.databaseUrl,
    authSecret: randomBytes(32).toString('base64url'),
    signingJwk: JSON.stringify(runtime.portalPrivateJwk),
    publicUrl: runtime.baseUrl,
  })
  runRequiredCommand(processes.build.command, processes.build.args, portalEnvironment)
  const [key, cert] = await Promise.all([
    readFile(runtime.privateKeyPath),
    readFile(runtime.certificatePath),
  ])
  return coordinatePortalStartup({
    startProxy: () => startHttpsProxy({
      key,
      cert,
      upstreamOrigin: processes.proxy.upstreamOrigin,
      listenPort: processes.proxy.listenPort,
      listenHost: processes.proxy.listenHost,
      httpsPort: runtime.httpsPort,
    }),
    startChild: () => startNextChild(processes.app, portalEnvironment),
  })
}

export async function coordinatePortalStartup({
  startProxy,
  startChild,
}: {
  startProxy: () => Promise<FixtureServer>
  startChild: () => Promise<FixtureServer>
}): Promise<FixtureServer> {
  const proxy = await startProxy()
  let child: FixtureServer | undefined
  try {
    child = await startChild()
  } catch (error) {
    await proxy.stop()
    throw error
  }
  return {
    stop: async () => {
      try {
        await proxy.stop()
      } finally {
        await child.stop()
      }
    },
  }
}

async function startHttpsProxy({
  key,
  cert,
  upstreamOrigin,
  listenPort,
  listenHost,
  httpsPort,
}: {
  key: Buffer
  cert: Buffer
  upstreamOrigin: string
  listenPort: number
  listenHost: string
  httpsPort: number
}): Promise<FixtureServer> {
  const proxy = createHttpsServer({ key, cert }, (incoming, outgoing) => {
    const upstream = httpRequest(`${upstreamOrigin}${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers: buildProxyHeaders(incoming.headers, httpsPort),
      timeout: PROXY_REQUEST_TIMEOUT_MS,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    })
    upstream.once('timeout', () => upstream.destroy(new Error('Upstream request timed out')))
    upstream.once('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'application/json' })
      outgoing.end('{"error":"upstream unavailable"}')
    })
    incoming.once('aborted', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  try {
    await new Promise<void>((resolveListen, reject) => {
      proxy.once('error', reject)
      proxy.listen(listenPort, listenHost, resolveListen)
    })
  } catch (error) {
    await closeServer(proxy)
    throw error
  }
  return { stop: () => closeServer(proxy) }
}

async function startNextChild(
  app: { command: string; args: string[] },
  environment: NodeJS.ProcessEnv,
): Promise<FixtureServer> {
  const child = spawn(app.command, app.args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    shell: false,
  })
  try {
    await new Promise<void>((resolveSpawn, reject) => {
      child.once('spawn', resolveSpawn)
      child.once('error', reject)
    })
  } catch (error) {
    await stopChild(child)
    throw error
  }
  return { stop: () => stopChild(child) }
}

export function buildProxyHeaders(
  headers: Record<string, string | string[] | undefined>,
  httpsPort: number,
): Record<string, string | string[] | undefined> {
  const originalHost = typeof headers.host === 'string' ? headers.host : `localhost:${httpsPort}`
  return {
    ...headers,
    'x-forwarded-host': originalHost,
    'x-forwarded-proto': 'https',
  }
}

export function buildPortalProcesses({ appPort, httpsPort }: {
  appPort: number
  httpsPort: number
}): {
  build: { command: string; args: string[] }
  app: { command: string; args: string[] }
  proxy: { upstreamOrigin: string; listenHost: string; listenPort: number }
} {
  return {
    build: { command: 'npm', args: ['run', 'build'] },
    app: {
      command: 'node_modules/.bin/next',
      args: ['start', '--hostname', '127.0.0.1', '--port', String(appPort)],
    },
    proxy: {
      upstreamOrigin: `http://127.0.0.1:${appPort}`,
      listenHost: '127.0.0.1',
      listenPort: httpsPort,
    },
  }
}

export function buildPortalEnvironment(
  inheritedEnv: Record<string, string | undefined>,
  fixture: {
    databaseUrl: string
    authSecret: string
    signingJwk: string
    publicUrl: string
  },
): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'CI', 'NEXT_TELEMETRY_DISABLED'] as const
  const environment: Record<string, string | undefined> = Object.fromEntries(
    allowed.map((name) => [name, inheritedEnv[name]]),
  )
  return compactEnvironment({
    ...environment,
    DATABASE_URL: fixture.databaseUrl,
    AUTH_SECRET: fixture.authSecret,
    AUTH_TRUST_HOST: 'true',
    SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK: fixture.signingJwk,
    SUPPORT_TOWER_PUBLIC_URL: fixture.publicUrl,
    DATABASE_POOL_MAX: '5',
  })
}

async function waitForPortal(runtime: FixtureRuntime): Promise<void> {
  const certificate = await readFile(runtime.certificatePath)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolveReady, reject) => {
        const portalRequest = request(`${runtime.baseUrl}/login`, {
          ca: certificate,
          rejectUnauthorized: true,
          timeout: 5_000,
        }, (response) => {
          response.resume()
          if (response.statusCode && response.statusCode < 500) resolveReady()
          else reject(new Error('Portal returned an unavailable status'))
        })
        portalRequest.once('timeout', () => portalRequest.destroy(new Error('Portal readiness timed out')))
        portalRequest.once('error', reject)
        portalRequest.end()
      })
      return
    } catch {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 500))
    }
  }
  throw new Error('Disposable HTTPS portal did not become ready')
}

async function runLoadHarness(
  runtime: FixtureRuntime,
  inheritedEnv: Record<string, string | undefined>,
): Promise<void> {
  await runRequiredCommandAsync('npm', ['run', 'load:test:support'], compactEnvironment({
    ...inheritedEnv,
    NODE_EXTRA_CA_CERTS: runtime.certificatePath,
    LOAD_TEST_BASE_URL: runtime.baseUrl,
    LOAD_TEST_DATABASE_URL: runtime.databaseUrl,
    LOAD_TEST_APP_ID: runtime.appId,
    LOAD_TEST_CREDENTIAL_ID: runtime.credentialId,
    LOAD_TEST_PRIVATE_JWK: JSON.stringify(runtime.privateJwk),
    LOAD_TEST_RUN_ID: `release-${Date.now()}`,
  }))
}

async function cleanupFixture(runtime: FixtureRuntime): Promise<void> {
  const pool = new Pool({ connectionString: runtime.databaseUrl, max: 1 })
  try {
    await pool.query('delete from source_apps where id = $1', [runtime.appId])
    await pool.query('delete from support_groups where id = $1', [runtime.groupId])
  } finally {
    await pool.end()
  }
}

function runRequiredCommand(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`${command} failed during disposable load preparation`)
}

async function runRequiredCommandAsync(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit', shell: false })
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  if (result.code !== 0) throw new Error(`${command} failed during disposable load verification`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
    new Promise<boolean>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 10_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function closeServer(server: ReturnType<typeof createHttpsServer>): Promise<void> {
  server.closeIdleConnections?.()
  server.closeAllConnections?.()
  await Promise.race([
    new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 10_000)),
  ])
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a local HTTPS port'))
        return
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

function compactEnvironment(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ) as NodeJS.ProcessEnv
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runDisposableLoadFixture().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Disposable load verification failed'}\n`)
    process.exitCode = 1
  })
}
