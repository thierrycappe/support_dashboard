import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { dockerServerArguments, SUPPORT_E2E_IMAGE } from './container-launcher'

const sourceDatabaseUrl = approvedTestDatabaseUrl()
const containerDatabaseUrl = new URL(sourceDatabaseUrl)
if (containerDatabaseUrl.hostname === '127.0.0.1' || containerDatabaseUrl.hostname === 'localhost') {
  containerDatabaseUrl.hostname = 'host.docker.internal'
}
const runId = randomUUID()
const containerName = `support-task22-e2e-${runId}`
const networkName = `support-task22-net-${runId}`
const port = process.env.PORT?.trim() || '3000'
const runtimeDirectory = resolve(process.cwd(), 'playwright/.runtime')
const envFile = resolve(runtimeDirectory, `server-${runId}.env`)
cleanupStaleResources()
rmSync(runtimeDirectory, { recursive: true, force: true })
await mkdir(runtimeDirectory, { recursive: true })
await writeFile(envFile, [
  `TEST_DATABASE_URL=${containerDatabaseUrl.toString()}`,
  `PORT=${port}`,
  'SUPPORT_E2E_CONTAINERIZED=1',
  '',
].join('\n'), { mode: 0o600 })

let cleaning = false
function cleanup(): void {
  if (cleaning) return
  cleaning = true
  spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' })
  rmSync(runtimeDirectory, { recursive: true, force: true })
  removeDockerNetwork(networkName)
}
let server: ReturnType<typeof spawn>
try {
  run('docker', ['build', '--quiet', '-f', 'e2e/setup/Dockerfile', '-t', SUPPORT_E2E_IMAGE, '.'])
  run('docker', ['network', 'create', '--label', 'support.task22.e2e=1', '--subnet', '93.184.216.0/24', networkName])
  server = spawn('docker', dockerServerArguments({
    containerName, networkName, port, envFile, runtimeDirectory,
  }), { stdio: 'inherit' })
} catch (error) {
  cleanup()
  throw error
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  cleanup()
  process.exit(0)
})
server.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} failed`)
}

function cleanupStaleResources(): void {
  const containers = dockerLines(['ps', '-a', '--format', '{{.Names}}', '--filter', 'label=support.task22.e2e=1'])
    .filter((name) => /^support-task22-e2e-[0-9a-f-]+$/.test(name))
  for (const container of containers) spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
  const networks = dockerLines(['network', 'ls', '--format', '{{.Name}}', '--filter', 'label=support.task22.e2e=1'])
    .filter((name) => /^support-task22-net-[0-9a-f-]+$/.test(name))
  for (const network of networks) removeDockerNetwork(network)
}

function dockerLines(args: string[]): string[] {
  return spawnSync('docker', args, { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)
}

function removeDockerNetwork(name: string): void {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = spawnSync('docker', ['network', 'rm', name], { stdio: 'ignore' })
    if (result.status === 0) return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
}

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
