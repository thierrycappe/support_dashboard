import { randomUUID } from 'node:crypto'
import { dispatchDelivery, type DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import {
  claimLegacyDeliveries,
  DEFAULT_LEASE_DURATION_MS,
  finishDelivery,
  getDatabaseDeliveryChannel,
  releaseLegacyConfigurationNotReady,
  renewDeliveryLease,
} from '@/lib/delivery/repository'
import type { ChannelConfig, DeliveryEvent } from '@/lib/delivery/types'
import { getDb, type Db } from '@/lib/db'
import { getPushoverConfig } from '@/lib/notifications/pushover'
import { after } from 'next/server.js'
import { decryptChannelConfig, loadChannelKeyring, type ChannelKeyring } from '@/lib/routing/crypto'
import { parseChannelConfig } from '@/lib/routing/channel-schemas'

export interface DeliverySweepResult {
  claimed: number
  started: number
  sent: number
  retrying: number
  failed: number
  configurationNotReady: number
}

type DeliverySender = (input: {
  event: DeliveryEvent
  config: ChannelConfig
  idempotencyKey: string
}) => Promise<DeliveryAdapterResult>

export async function runDeliverySweep({
  db = getDb(),
  limit = 100,
  now = new Date(),
  workerId = randomUUID(),
  legacyConfig = defaultLegacyConfig(),
  send = dispatchDelivery,
  keyring,
  loadDatabaseChannel = getDatabaseDeliveryChannel,
  concurrency = 20,
  leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
  leaseRenewalMs = Math.max(1, Math.floor(leaseDurationMs / 3)),
  deliveryIds,
}: {
  db?: Db
  limit?: number
  now?: Date
  workerId?: string
  legacyConfig?: { type: 'PUSHOVER'; appToken: string; userKey: string } | null
  send?: DeliverySender
  keyring?: ChannelKeyring | null
  loadDatabaseChannel?: typeof getDatabaseDeliveryChannel
  concurrency?: number
  leaseDurationMs?: number
  leaseRenewalMs?: number
  deliveryIds?: readonly string[]
} = {}): Promise<DeliverySweepResult> {
  const activeConcurrency = Math.max(1, Math.floor(concurrency))
  const channelKeyring = keyring === undefined ? loadKeyringSafely() : keyring
  // Claim only work we can start now. Queued claimed rows would otherwise
  // consume their lease while waiting behind a slow provider.
  const claimed = await claimLegacyDeliveries({
    db, limit: Math.min(limit, activeConcurrency), now, workerId, leaseDurationMs, deliveryIds,
  })
  const result: DeliverySweepResult = {
    claimed: claimed.length,
    started: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    configurationNotReady: 0,
  }

  await runWithConcurrency(claimed, activeConcurrency, async (job) => {
    const stopRenewal = await beginLeaseRenewal({ db, id: job.id, workerId, leaseDurationMs, leaseRenewalMs })
    if (!stopRenewal) return
    try {
      const config = await configForJob({ db, job, legacyConfig, keyring: channelKeyring, loadDatabaseChannel })
      if (!config) {
        if (job.configSource === 'LEGACY_ENV') {
          await releaseLegacyConfigurationNotReady({ db, id: job.id, workerId, now })
          result.configurationNotReady += 1
          return
        }
        await finishConfigurationFailure({ db, id: job.id, workerId })
        result.failed += 1
        return
      }

      result.started += 1
      const startedAt = new Date()
      const outcome = await send({
        event: job.renderedPayload as unknown as DeliveryEvent,
        config,
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

async function beginLeaseRenewal({
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
}): Promise<(() => void) | null> {
  const renewed = await renewDeliveryLease({ db, id, workerId, now: new Date(), leaseDurationMs }).catch(() => false)
  if (!renewed) return null
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

async function configForJob({
  db,
  job,
  legacyConfig,
  keyring,
  loadDatabaseChannel,
}: {
  db: Db
  job: Awaited<ReturnType<typeof claimLegacyDeliveries>>[number]
  legacyConfig: { type: 'PUSHOVER'; appToken: string; userKey: string } | null
  keyring: ChannelKeyring | null
  loadDatabaseChannel: typeof getDatabaseDeliveryChannel
}): Promise<ChannelConfig | null> {
  if (job.configSource === 'LEGACY_ENV') return legacyConfig
  if (!job.channelId || !keyring) return null
  try {
    const channel = await loadDatabaseChannel({ db, channelId: job.channelId })
    if (!channel || channel.type !== job.channelType) return null
    const config = decryptChannelConfig({
      keyVersion: `v${channel.keyVersion}`,
      nonce: channel.configNonce,
      ciphertext: channel.encryptedConfig,
      authTag: channel.configAuthTag,
    }, { channelId: channel.id, type: channel.type }, keyring)
    return parseChannelConfig(channel.type, config)
  } catch {
    return null
  }
}

async function finishConfigurationFailure({ db, id, workerId }: { db: Db; id: string; workerId: string }): Promise<void> {
  const startedAt = new Date()
  await finishDelivery({
    db,
    id,
    workerId,
    startedAt,
    finishedAt: new Date(),
    result: { result: 'permanent', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: 'CONFIGURATION_INVALID' },
  })
}

function loadKeyringSafely(): ChannelKeyring | null {
  try {
    return loadChannelKeyring()
  } catch {
    return null
  }
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
