import { randomUUID } from 'node:crypto'
import { sendPushoverDelivery } from '@/lib/delivery/adapters/pushover'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import {
  claimLegacyDeliveries,
  DEFAULT_LEASE_DURATION_MS,
  finishDelivery,
  recordConfigurationNotReady,
  releaseLegacyConfigurationNotReady,
  renewDeliveryLease,
} from '@/lib/delivery/repository'
import type { DeliveryEvent } from '@/lib/delivery/types'
import { getDb, type Db } from '@/lib/db'
import { getPushoverConfig } from '@/lib/notifications/pushover'
import { after } from 'next/server'

export interface DeliverySweepResult {
  claimed: number
  started: number
  sent: number
  retrying: number
  failed: number
  configurationNotReady: number
}

type LegacyDeliverySender = (input: {
  event: DeliveryEvent
  config: { type: 'PUSHOVER'; appToken: string; userKey: string }
  idempotencyKey: string
}) => Promise<DeliveryAdapterResult>

export async function runDeliverySweep({
  db = getDb(),
  limit = 100,
  now = new Date(),
  workerId = randomUUID(),
  legacyConfig = defaultLegacyConfig(),
  send = sendPushoverDelivery,
  concurrency = 20,
  leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
  leaseRenewalMs = Math.max(1, Math.floor(leaseDurationMs / 3)),
}: {
  db?: Db
  limit?: number
  now?: Date
  workerId?: string
  legacyConfig?: { type: 'PUSHOVER'; appToken: string; userKey: string } | null
  send?: LegacyDeliverySender
  concurrency?: number
  leaseDurationMs?: number
  leaseRenewalMs?: number
} = {}): Promise<DeliverySweepResult> {
  const activeConcurrency = Math.max(1, Math.floor(concurrency))
  const configurationNotReady = await recordConfigurationNotReady({ db, now, limit })
  // Claim only work we can start now. Queued claimed rows would otherwise
  // consume their lease while waiting behind a slow provider.
  const claimed = await claimLegacyDeliveries({ db, limit: Math.min(limit, activeConcurrency), now, workerId, leaseDurationMs })
  const result: DeliverySweepResult = {
    claimed: claimed.length,
    started: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    configurationNotReady,
  }

  await runWithConcurrency(claimed, activeConcurrency, async (job) => {
    if (!legacyConfig) {
      await releaseLegacyConfigurationNotReady({ db, id: job.id, workerId, now })
      result.configurationNotReady += 1
      return
    }

    result.started += 1
    const stopRenewal = beginLeaseRenewal({ db, id: job.id, workerId, leaseDurationMs, leaseRenewalMs })
    try {
      const startedAt = new Date()
      const outcome = await send({
        event: job.renderedPayload as unknown as DeliveryEvent,
        config: legacyConfig,
        idempotencyKey: job.eventKey,
      })
      const finishedAt = new Date()
      const finalized = await finishDelivery({ db, id: job.id, workerId, startedAt, finishedAt, result: outcome })
      if (!finalized) return
      if (outcome.result === 'sent') result.sent += 1
      else if (outcome.result === 'permanent') result.failed += 1
      else result.retrying += 1
    } finally {
      stopRenewal()
    }
  })
  return result
}

function beginLeaseRenewal({
  db,
  id,
  workerId,
  leaseDurationMs,
  leaseRenewalMs,
}: {
  db: Db
  id: string
  workerId: string
  leaseDurationMs: number
  leaseRenewalMs: number
}): () => void {
  const timer = setInterval(() => {
    // A transient renewal failure must not turn an already-dispatched job into
    // an unhandled rejection. The original lease still protects it until the
    // next renewal tick, and finalization remains ownership-checked.
    void renewDeliveryLease({ db, id, workerId, now: new Date(), leaseDurationMs }).catch(() => {})
  }, Math.max(1, leaseRenewalMs))
  timer.unref?.()
  return () => clearInterval(timer)
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const workerCount = Math.min(values.length, Math.max(1, concurrency))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < values.length) {
      const value = values[cursor++]
      if (value) await work(value)
    }
  }))
}

function defaultLegacyConfig(): { type: 'PUSHOVER'; appToken: string; userKey: string } | null {
  const config = getPushoverConfig()
  return config ? { type: 'PUSHOVER', ...config } : null
}

export async function drainImmediateDeliveries({
  batchSize = 100,
  maxJobs = 500,
  maxDurationMs = 45_000,
  sweep = runDeliverySweep,
}: {
  batchSize?: number
  maxJobs?: number
  maxDurationMs?: number
  sweep?: (input: { limit: number }) => Promise<Pick<DeliverySweepResult, 'started'>>
} = {}): Promise<{ started: number; batches: number }> {
  const startedAt = Date.now()
  let started = 0
  let batches = 0
  while (started < maxJobs && Date.now() - startedAt < maxDurationMs) {
    const result = await sweep({ limit: Math.min(batchSize, maxJobs - started) })
    batches += 1
    started += result.started
    if (result.started === 0) break
  }
  return { started, batches }
}

export function scheduleDeliveryWakeup({
  afterImpl = after,
  drain = drainImmediateDeliveries,
}: {
  afterImpl?: (task: () => Promise<void>) => void
  drain?: () => Promise<unknown>
} = {}): void {
  try {
    afterImpl(async () => { await drain() })
  } catch {
    // Scheduling is post-commit best effort; the cron recovery path remains durable.
  }
}
