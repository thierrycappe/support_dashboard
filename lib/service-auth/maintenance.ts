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
  const deadline = Date.now() + REPLAY_CLEANUP_MAX_DURATION_MS
  try {
    while (
      metrics.batches < REPLAY_CLEANUP_MAX_BATCHES
      && metrics.rowsDeleted < REPLAY_CLEANUP_MAX_ROWS
    ) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) return { status: 'timed_out', ...metrics }
      const limit = Math.min(REPLAY_CLEANUP_BATCH_SIZE, REPLAY_CLEANUP_MAX_ROWS - metrics.rowsDeleted)
      const deleted = await cleanupExpiredAssertionReplays({ limit, statementTimeoutMs: remainingMs })
      metrics.batches += 1
      metrics.rowsDeleted += deleted
      if (deleted < limit) return { status: 'completed', ...metrics }
    }
    return { status: 'bounded', ...metrics }
  } catch (error) {
    return { status: isQueryTimeout(error) ? 'timed_out' : 'failed', ...metrics }
  }
}

function isQueryTimeout(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === '57014') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
