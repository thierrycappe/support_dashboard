import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent, type AuditMutationContext } from '@/lib/audit/events'
import { getDb, type Db } from '@/lib/db'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import type { DeliveryChannelType } from '@/lib/delivery/types'

export const retryDelaysMs = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
] as const

export const DEFAULT_LEASE_DURATION_MS = 60_000
const MAX_RETRY_AFTER_MS = 60 * 60_000

export interface ClaimedDelivery {
  id: string
  eventKey: string
  targetKey: string
  renderedPayload: Record<string, unknown>
  attemptCount: number
  channelId: string | null
  channelType: DeliveryChannelType
  configSource: 'DATABASE' | 'LEGACY_ENV'
}

export interface DatabaseDeliveryChannel {
  id: string
  type: DeliveryChannelType
  encryptedConfig: string
  configNonce: string
  configAuthTag: string
  keyVersion: number
}

export interface RetriedDelivery {
  id: string
  generation: number
  status: 'PENDING'
}

export type RetryFailedDeliveryResult =
  | { outcome: 'created'; delivery: RetriedDelivery }
  | { outcome: 'duplicate'; delivery: RetriedDelivery }

export class DeliveryRetryError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'STALE') {
    super(code === 'NOT_FOUND'
      ? 'Delivery not found'
      : code === 'NOT_ELIGIBLE'
        ? 'Only failed deliveries can be retried'
        : 'Delivery retry is no longer pending')
    this.name = 'DeliveryRetryError'
  }
}

export async function retryFailedDelivery({
  db = getDb(),
  id,
  actorId,
  correlationId,
  reason,
  now = new Date(),
}: AuditMutationContext & {
  db?: Db
  id: string
  now?: Date
}): Promise<RetryFailedDeliveryResult> {
  return db.transaction(async (tx) => {
    const sourceResult = await tx.execute<{
      id: string
      escalationEventId: string
      eventKey: string
      targetKey: string
      generation: number
      channelId: string | null
      channelType: DeliveryChannelType
      configSource: 'DATABASE' | 'LEGACY_ENV'
      renderedPayload: Record<string, unknown>
      status: string
    }>(sql`
      select id, escalation_event_id as "escalationEventId", event_key as "eventKey", target_key as "targetKey",
        generation, channel_id as "channelId", channel_type::text as "channelType", config_source as "configSource",
        rendered_payload as "renderedPayload", status::text as status
        from delivery_outbox
       where id = ${id}
       for update
    `)
    const source = sourceResult.rows[0]
    if (!source) throw new DeliveryRetryError('NOT_FOUND')
    if (source.status !== 'FAILED') throw new DeliveryRetryError('NOT_ELIGIBLE')

    const nextGeneration = source.generation + 1
    const newId = nanoid()
    const inserted = await tx.execute<RetriedDelivery & Record<string, unknown>>(sql`
      insert into delivery_outbox (
        id, escalation_event_id, event_key, target_key, generation, channel_id, channel_type, config_source,
        rendered_payload, status, next_attempt_at, attempt_count, created_at, updated_at
      ) values (
        ${newId}, ${source.escalationEventId}, ${source.eventKey}, ${source.targetKey}, ${nextGeneration},
        ${source.channelId}, ${source.channelType}::"ChannelType", ${source.configSource},
        ${JSON.stringify(source.renderedPayload)}::jsonb, 'PENDING'::"DeliveryStatus", ${now}, 0, ${now}, ${now}
      ) on conflict (event_key, target_key, generation) do nothing
      returning id, generation, status::text as status
    `)
    const created = inserted.rows[0]
    if (created) {
      await appendAuditEvent({
        db: tx,
        actorId,
        correlationId,
        reason,
        action: 'DELIVERY_REQUEUED',
        subjectType: 'delivery_outbox',
        subjectId: created.id,
        metadata: { previousDeliveryId: source.id, generation: created.generation, target: source.targetKey },
        now,
      })
      return { outcome: 'created', delivery: { ...created, status: 'PENDING' } }
    }

    const existing = await tx.execute<RetriedDelivery & Record<string, unknown>>(sql`
      select id, generation, status::text as status
        from delivery_outbox
       where event_key = ${source.eventKey} and target_key = ${source.targetKey} and generation = ${nextGeneration}
       limit 1
    `)
    const retried = existing.rows[0]
    if (!retried) throw new DeliveryRetryError('STALE')
    if (retried.status !== 'PENDING') throw new DeliveryRetryError('STALE')
    return { outcome: 'duplicate', delivery: { ...retried, status: 'PENDING' } }
  })
}

export async function claimLegacyDeliveries({
  db = getDb(),
  limit,
  now,
  workerId,
  leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
}: {
  db?: Db
  limit: number
  now: Date
  workerId: string
  leaseDurationMs?: number
}): Promise<ClaimedDelivery[]> {
  const leaseUntil = new Date(now.getTime() + leaseDurationMs)
  const result = await db.execute<ClaimedDelivery & Record<string, unknown>>(sql`
    with candidates as (
      select id
        from delivery_outbox
       where (
           (status in ('PENDING', 'RETRYING') and next_attempt_at <= ${now})
           or (status = 'LEASED' and lease_expires_at <= ${now})
         )
       order by next_attempt_at, id
       limit ${limit}
       for update skip locked
    )
    update delivery_outbox outbox
       set status = 'LEASED', lease_token = ${workerId}, lease_expires_at = ${leaseUntil}, updated_at = ${now}
      from candidates
     where outbox.id = candidates.id
     returning outbox.id,
       outbox.event_key as "eventKey",
       outbox.target_key as "targetKey",
       outbox.rendered_payload as "renderedPayload",
       outbox.attempt_count as "attemptCount",
       outbox.channel_id as "channelId",
       outbox.channel_type::text as "channelType",
       outbox.config_source as "configSource"
  `)
  return result.rows
}

export async function getDatabaseDeliveryChannel({
  db = getDb(),
  channelId,
}: {
  db?: Db
  channelId: string
}): Promise<DatabaseDeliveryChannel | null> {
  const result = await db.execute<DatabaseDeliveryChannel & Record<string, unknown>>(sql`
    select id, type::text as type, encrypted_config as "encryptedConfig", config_nonce as "configNonce",
      config_auth_tag as "configAuthTag", key_version as "keyVersion"
      from notification_channels
     where id = ${channelId} and status = 'ACTIVE'
  `)
  return result.rows[0] ?? null
}

export async function renewDeliveryLease({
  db = getDb(),
  id,
  workerId,
  now,
  leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
}: {
  db?: Db
  id: string
  workerId: string
  now: Date
  leaseDurationMs?: number
}): Promise<boolean> {
  const leaseUntil = new Date(now.getTime() + leaseDurationMs)
  const result = await db.execute<{ id: string }>(sql`
    update delivery_outbox
       set lease_expires_at = ${leaseUntil}, updated_at = ${now}
     where id = ${id} and status = 'LEASED' and lease_token = ${workerId}
     returning id
  `)
  return result.rows.length === 1
}

export async function finishDelivery({
  db = getDb(),
  id,
  workerId,
  startedAt,
  finishedAt,
  result,
}: {
  db?: Db
  id: string
  workerId: string
  startedAt: Date
  finishedAt: Date
  result: DeliveryAdapterResult
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const leased = await tx.execute<{
      id: string
      targetKey: string
      attemptCount: number
    }>(sql`
      update delivery_outbox
         set attempt_count = attempt_count + 1,
             lease_token = null,
             lease_expires_at = null,
             updated_at = ${finishedAt}
       where id = ${id} and lease_token = ${workerId} and status = 'LEASED'
       returning id, target_key as "targetKey", attempt_count as "attemptCount"
    `)
    const row = leased.rows[0]
    if (!row) return false

    const transition = transitionFor(id, row.attemptCount, finishedAt, result)
    await tx.execute(sql`
      update delivery_outbox
         set status = ${transition.status}::"DeliveryStatus",
             next_attempt_at = ${transition.nextAttemptAt},
             sent_at = case when ${transition.status} = 'SENT' then ${finishedAt} else sent_at end,
             updated_at = ${finishedAt}
       where id = ${id}
    `)
    await tx.execute(sql`
      insert into delivery_attempts (
        id, outbox_id, ordinal, target_key, started_at, finished_at, result_class,
        provider_status, sanitized_error, provider_message_id, created_at
      ) values (
        ${nanoid()}, ${id}, ${row.attemptCount}, ${row.targetKey}, ${startedAt}, ${finishedAt}, ${result.result},
        ${result.providerStatus === null ? null : String(result.providerStatus)}, ${result.sanitizedError},
        ${result.providerMessageId}, ${finishedAt}
      )
    `)
    return true
  })
}

export async function recordConfigurationNotReady({
  db = getDb(),
  now,
  limit,
}: {
  db?: Db
  now: Date
  limit: number
}): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    with candidates as (
      select id, target_key
        from delivery_outbox
       where config_source = 'DATABASE'
         and status in ('PENDING', 'RETRYING')
         and next_attempt_at <= ${now}
       order by next_attempt_at, id
       limit ${limit}
    )
    insert into delivery_attempts (
      id, outbox_id, ordinal, target_key, started_at, finished_at, result_class, created_at
    )
    select md5('configuration-not-ready:' || candidates.id), candidates.id, 0, candidates.target_key,
      ${now}, ${now}, 'CONFIGURATION_NOT_READY', ${now}
      from candidates
    on conflict (outbox_id, ordinal) do nothing
    returning outbox_id as id
  `)
  return result.rows.length
}

export async function releaseLegacyConfigurationNotReady({
  db = getDb(),
  id,
  workerId,
  now,
  nextAttemptAt = new Date(now.getTime() + jitteredDelay(id, retryDelaysMs[0])),
}: {
  db?: Db
  id: string
  workerId: string
  now: Date
  nextAttemptAt?: Date
}): Promise<void> {
  await db.transaction(async (tx) => {
    const released = await tx.execute<{ targetKey: string }>(sql`
      update delivery_outbox
         set status = 'PENDING', lease_token = null, lease_expires_at = null,
             next_attempt_at = ${nextAttemptAt},
             updated_at = ${now}
       where id = ${id} and lease_token = ${workerId} and status = 'LEASED'
       returning target_key as "targetKey"
    `)
    const row = released.rows[0]
    if (!row) return
    await tx.execute(sql`
      insert into delivery_attempts (
        id, outbox_id, ordinal, target_key, started_at, finished_at, result_class, created_at
      ) values (
        ${nanoid()}, ${id}, 0, ${row.targetKey}, ${now}, ${now}, 'CONFIGURATION_NOT_READY', ${now}
      ) on conflict (outbox_id, ordinal) do nothing
    `)
  })
}

function transitionFor(
  id: string,
  attemptCount: number,
  now: Date,
  result: DeliveryAdapterResult,
): { status: 'SENT' | 'RETRYING' | 'FAILED'; nextAttemptAt: Date } {
  if (result.result === 'sent') return { status: 'SENT', nextAttemptAt: now }
  if (result.result === 'permanent' || attemptCount > retryDelaysMs.length) {
    return { status: 'FAILED', nextAttemptAt: now }
  }
  const retryAfterMs = result.retryAfterMs === null
    ? null
    : Math.min(Math.max(result.retryAfterMs, 0), MAX_RETRY_AFTER_MS)
  const delay = retryAfterMs ?? jitteredDelay(id, retryDelaysMs[attemptCount - 1]!)
  return { status: 'RETRYING', nextAttemptAt: new Date(now.getTime() + delay) }
}

export function jitteredDelay(outboxId: string, delayMs: number): number {
  let hash = 2_166_136_261
  for (const character of outboxId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  const percent = ((hash >>> 0) / 0xffff_ffff) * 0.2 - 0.1
  return Math.round(delayMs * (1 + percent))
}
