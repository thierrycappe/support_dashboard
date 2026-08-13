import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type VerificationGate = {
  label: string
  command: string
  args: string[]
}

export type VerificationSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>

const verificationGates: readonly VerificationGate[] = [
  { label: 'unit tests', command: 'npm', args: ['run', 'test:run'] },
  { label: 'integration tests', command: 'npm', args: ['run', 'test:integration'] },
  { label: 'scenario drift', command: 'npm', args: ['run', 'scenario:check'] },
  { label: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
  { label: 'lint', command: 'npm', args: ['run', 'lint'] },
  { label: 'production build', command: 'npm', args: ['run', 'build'] },
  { label: 'Playwright journeys', command: 'npx', args: ['playwright', 'test', 'e2e/scenarios/control-tower'] },
  {
    label: 'legacy-schema upgrade rehearsal',
    command: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.integration.config.ts', 'tests/integration/schema-migration.test.ts'],
  },
  { label: '500-escalation burst', command: 'npx', args: ['tsx', 'scripts/run-load-escalation-fixture.ts'] },
  { label: 'git diff check', command: 'git', args: ['diff', '--check'] },
]

export function runSupportOverhaulVerification({
  spawn = spawnSync as VerificationSpawn,
  writeError = (message: string) => process.stderr.write(message),
}: {
  spawn?: VerificationSpawn
  writeError?: (message: string) => void
} = {}): number {
  for (const gate of verificationGates) {
    const outcome = spawn(gate.command, gate.args, { stdio: 'inherit', shell: false })
    if (outcome.status !== 0) {
      writeError(`Support overhaul verification failed at gate: ${gate.label}\n`)
      return outcome.status ?? 1
    }
  }

  return 0
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  process.exitCode = runSupportOverhaulVerification()
}
