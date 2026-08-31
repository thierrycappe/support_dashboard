import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

import {
  runSupportOverhaulVerification,
  type VerificationSpawn,
} from '@/scripts/verify-support-overhaul'

const gateLabels = [
  'unit tests',
  'integration tests',
  'scenario drift',
  'typecheck',
  'lint',
  'production build',
  'Playwright journeys',
  'legacy-schema upgrade rehearsal',
  '500-escalation burst',
  'git diff check',
] as const

function result(status: number): SpawnSyncReturns<Buffer> {
  return {
    pid: 42,
    output: [null, null, null],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status,
    signal: null,
  }
}

describe('support overhaul verification', () => {
  it.each(gateLabels.map((label, index) => ({ label, index })))(
    'stops immediately and names the failed $label gate',
    ({ label, index }) => {
      let callCount = 0
      const spawn = vi.fn<VerificationSpawn>(() => {
        callCount += 1
        return result(callCount === index + 1 ? 23 : 0)
      })
      const writeError = vi.fn()

      const exitCode = runSupportOverhaulVerification({ spawn, writeError })

      expect(exitCode).toBe(23)
      expect(spawn).toHaveBeenCalledTimes(index + 1)
      expect(writeError).toHaveBeenCalledOnce()
      expect(writeError).toHaveBeenCalledWith(`Support overhaul verification failed at gate: ${label}\n`)
    },
  )

  it('runs every gate in release order using inherited output and argument arrays', () => {
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnSyncOptions }> = []
    const spawn: VerificationSpawn = (command, args, options) => {
      calls.push({ command, args, options })
      return result(0)
    }
    const writeError = vi.fn()

    const exitCode = runSupportOverhaulVerification({ spawn, writeError })

    expect(exitCode).toBe(0)
    expect(writeError).not.toHaveBeenCalled()
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ['npm', 'run', 'test:run'],
      ['npm', 'run', 'test:integration'],
      ['npm', 'run', 'scenario:check'],
      ['npm', 'run', 'typecheck'],
      ['npm', 'run', 'lint'],
      ['npm', 'run', 'build'],
      ['npx', 'playwright', 'test', 'e2e/scenarios/control-tower'],
      ['npx', 'vitest', 'run', '--config', 'vitest.integration.config.ts', 'tests/integration/schema-migration.test.ts'],
      ['npx', 'tsx', 'scripts/run-load-escalation-fixture.ts'],
      ['git', 'diff', '--check'],
    ])
    expect(calls.every(({ options }) => options.stdio === 'inherit' && options.shell === false)).toBe(true)
  })
})
