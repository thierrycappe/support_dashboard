import { cleanupExpiredAssertionReplays } from '@/lib/service-auth/assertions'

const REPLAY_CLEANUP_BATCH_SIZE = 100
const REPLAY_CLEANUP_MAX_BATCHES = 5
const REPLAY_CLEANUP_MAX_ROWS = 500
const REPLAY_CLEANUP_MAX_DURATION_MS = 1_000

export interface AssertionReplayCleanupOutcome {
  status: 'completed' | 'bounded' | 'failed' | 'timed_out'
  rowsDeleted: number
  batches: number
}

export async function drainExpiredAssertionReplays(): Promise<AssertionReplayCleanupOutcome> {
  const metrics = { rowsDeleted: 0, batches: 0 }
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const work = (async (): Promise<AssertionReplayCleanupOutcome> => {
    try {
      while (
        !timedOut
        && metrics.batches < REPLAY_CLEANUP_MAX_BATCHES
        && metrics.rowsDeleted < REPLAY_CLEANUP_MAX_ROWS
      ) {
        const limit = Math.min(REPLAY_CLEANUP_BATCH_SIZE, REPLAY_CLEANUP_MAX_ROWS - metrics.rowsDeleted)
        const deleted = await cleanupExpiredAssertionReplays({ limit })
        if (timedOut) break
        metrics.batches += 1
        metrics.rowsDeleted += deleted
        if (deleted < limit) return { status: 'completed', ...metrics }
      }
      return { status: 'bounded', ...metrics }
    } catch {
      return { status: 'failed', ...metrics }
    }
  })()

  const timeout = new Promise<AssertionReplayCleanupOutcome>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      resolve({ status: 'timed_out', ...metrics })
    }, REPLAY_CLEANUP_MAX_DURATION_MS)
  })
  const outcome = await Promise.race([work, timeout])
  if (outcome.status !== 'timed_out' && timeoutHandle) clearTimeout(timeoutHandle)
  return outcome
}
