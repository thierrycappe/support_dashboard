import { sendPushoverDelivery } from '@/lib/delivery/adapters/pushover'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import {
  claimLegacyDeliveries,
  finishDelivery,
  recordConfigurationNotReady,
  releaseLegacyConfigurationNotReady,
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
  workerId = 'delivery-worker',
  legacyConfig = defaultLegacyConfig(),
  send = sendPushoverDelivery,
}: {
  db?: Db
  limit?: number
  now?: Date
  workerId?: string
  legacyConfig?: { type: 'PUSHOVER'; appToken: string; userKey: string } | null
  send?: LegacyDeliverySender
} = {}): Promise<DeliverySweepResult> {
  const configurationNotReady = await recordConfigurationNotReady({ db, now, limit })
  const claimed = await claimLegacyDeliveries({ db, limit, now, workerId })
  const result: DeliverySweepResult = {
    claimed: claimed.length,
    started: claimed.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    configurationNotReady,
  }

  for (const job of claimed) {
    if (!legacyConfig) {
      await releaseLegacyConfigurationNotReady({ db, id: job.id, workerId, now })
      result.configurationNotReady += 1
      continue
    }

    const outcome = await send({
      event: job.renderedPayload as unknown as DeliveryEvent,
      config: legacyConfig,
      idempotencyKey: job.eventKey,
    })
    const finalized = await finishDelivery({ db, id: job.id, workerId, now, result: outcome })
    if (!finalized) continue
    if (outcome.result === 'sent') result.sent += 1
    else if (outcome.result === 'permanent') result.failed += 1
    else result.retrying += 1
  }
  return result
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
