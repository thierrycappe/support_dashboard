import { createCipheriv } from 'node:crypto'
import { createServer } from 'node:http'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { drainImmediateDeliveries, runDeliverySweep } from '@/lib/delivery/worker'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import { getDatabaseDeliveryChannel } from '@/lib/delivery/repository'
import { encryptChannelConfig, parseChannelKeyring } from '@/lib/routing/crypto'
import type { ChannelConfig } from '@/lib/delivery/types'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const now = new Date('2026-08-12T12:00:00.000Z')
const event = {
  ticketId: 'worker-ticket', appName: 'Worker App', kind: 'BUG' as const,
  priority: 'HIGH' as const, title: 'Worker failure', portalUrl: 'https://support.example.test/feedback/worker-ticket',
}
const channelKeyring = parseChannelKeyring(JSON.stringify({
  active: 'v1',
  keys: { v1: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
}))

beforeEach(async () => {
  await getDb().execute(sql`truncate table delivery_attempts, delivery_outbox, escalation_events, feedback_tickets, source_apps, support_groups cascade`)
  await seedGraph()
})

afterAll(async () => {
  await closeDbPool()
})

describe('runDeliverySweep', () => {
  it('uses SKIP LOCKED so two workers begin each legacy job once', async () => {
    await seedOutbox('job-a')
    await seedOutbox('job-b')
    const send = async (): Promise<DeliveryAdapterResult> => ({ result: 'sent', providerStatus: 202, providerMessageId: 'provider-id', retryAfterMs: null, sanitizedError: null })

    const [first, second] = await Promise.all([
      runDeliverySweep({ db: getDb(), limit: 2, now, workerId: 'worker-a', legacyConfig: legacyConfig(), send }),
      runDeliverySweep({ db: getDb(), limit: 2, now, workerId: 'worker-b', legacyConfig: legacyConfig(), send }),
    ])

    expect(first.started + second.started).toBe(2)
    expect(await outboxStatuses()).toEqual(['SENT', 'SENT'])
    expect(await scalar(sql`select count(*)::int as count from delivery_attempts`)).toBe(2)
  })

  it('records retryable failures with deterministic bounded jitter', async () => {
    await seedOutbox('job-retry')

    await runDeliverySweep({
      db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(),
      send: async () => ({ result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: 'NETWORK_ERROR' }),
    })

    const row = await outbox('job-retry')
    const timing = await attemptTiming('job-retry')
    expect(row.status).toBe('RETRYING')
    expect(row.attemptCount).toBe(1)
    expect(asDate(row.nextAttemptAt).getTime()).toBeGreaterThanOrEqual(asDate(timing.finishedAt).getTime() + 54_000)
    expect(asDate(row.nextAttemptAt).getTime()).toBeLessThanOrEqual(asDate(timing.finishedAt).getTime() + 66_000)
    expect(await attempt('job-retry')).toMatchObject({ resultClass: 'retryable', sanitizedError: 'NETWORK_ERROR' })
  })

  it('honors a retryable 429 Retry-After while bounding it to one hour', async () => {
    await seedOutbox('job-rate-limit')

    await runDeliverySweep({
      db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(),
      send: async () => ({ result: 'retryable', providerStatus: 429, providerMessageId: null, retryAfterMs: 2 * 60 * 60_000, sanitizedError: 'HTTP_429' }),
    })

    const timing = await attemptTiming('job-rate-limit')
    expect(asDate((await outbox('job-rate-limit')).nextAttemptAt)).toEqual(new Date(asDate(timing.finishedAt).getTime() + 60 * 60_000))
  })

  it('records permanent responses as failed and records provider metadata for sent jobs', async () => {
    await seedOutbox('job-failed')
    await seedOutbox('job-sent')
    const outcomes: Record<string, DeliveryAdapterResult> = {
      'event-job-failed': { result: 'permanent', providerStatus: 400, providerMessageId: null, retryAfterMs: null, sanitizedError: 'HTTP_400' },
      'event-job-sent': { result: 'sent', providerStatus: 202, providerMessageId: 'provider-message', retryAfterMs: null, sanitizedError: null },
    }

    await runDeliverySweep({ db: getDb(), now, workerId: 'worker', legacyConfig: legacyConfig(), send: async ({ idempotencyKey }) => outcomes[idempotencyKey]! })

    expect((await outbox('job-failed')).status).toBe('FAILED')
    expect(await attempt('job-failed')).toMatchObject({ resultClass: 'permanent', providerStatus: '400', sanitizedError: 'HTTP_400' })
    expect((await outbox('job-sent')).status).toBe('SENT')
    expect(await attempt('job-sent')).toMatchObject({ resultClass: 'sent', providerStatus: '202', providerMessageId: 'provider-message' })
  })

  it('recovers an expired legacy lease', async () => {
    await seedOutbox('job-expired', { status: 'LEASED', leaseExpiresAt: new Date(now.getTime() - 1_000) })

    await runDeliverySweep({ db: getDb(), now, workerId: 'recovery-worker', legacyConfig: legacyConfig(), send: async () => ({ result: 'sent', providerStatus: 200, providerMessageId: null, retryAfterMs: null, sanitizedError: null }) })

    expect((await outbox('job-expired')).status).toBe('SENT')
  })

  it('decrypts and dispatches database-backed email, Pushover, and webhook jobs', async () => {
    await seedDatabaseChannel('database-email', { type: 'EMAIL', to: ['alerts@example.test'] })
    await seedDatabaseChannel('database-pushover', { type: 'PUSHOVER', appToken: 'token', userKey: 'user' })
    await seedDatabaseChannel('database-webhook', { type: 'WEBHOOK', url: 'https://93.184.216.34/hook', signingSecret: 'secret' })
    await seedOutbox('job-database-email', { configSource: 'DATABASE', targetKey: 'channel:database-email', channelId: 'database-email', channelType: 'EMAIL' })
    await seedOutbox('job-database-pushover', { configSource: 'DATABASE', targetKey: 'channel:database-pushover', channelId: 'database-pushover', channelType: 'PUSHOVER', generation: 2 })
    await seedOutbox('job-database-webhook', { configSource: 'DATABASE', targetKey: 'channel:database-webhook', channelId: 'database-webhook', channelType: 'WEBHOOK', generation: 3 })
    const sentTypes: string[] = []

    const result = await runDeliverySweep({
      db: getDb(), limit: 3, now, workerId: 'worker', legacyConfig: legacyConfig(), keyring: channelKeyring,
      send: async ({ config }) => {
        sentTypes.push(config.type)
        return sent()
      },
    })

    expect(result).toMatchObject({ started: 3, sent: 3, configurationNotReady: 0 })
    expect(sentTypes.sort()).toEqual(['EMAIL', 'PUSHOVER', 'WEBHOOK'])
    expect(await outboxStatuses()).toEqual(['SENT', 'SENT', 'SENT'])
  })

  it('turns every database configuration failure into the same permanent sanitized attempt', async () => {
    const invalidPayload = encryptRawChannelPayload('database-invalid-plaintext', 'EMAIL', '{"to":[]}')
    const fixtures = [
      {
        name: 'missing-keyring', channelId: 'database-missing-keyring', channelType: 'EMAIL' as const,
        keyring: null,
        setup: () => seedDatabaseChannel('database-missing-keyring', { type: 'EMAIL', to: ['alerts@example.test'] }),
      },
      {
        name: 'inactive', channelId: 'database-inactive', channelType: 'EMAIL' as const,
        setup: () => seedDatabaseChannel('database-inactive', { type: 'EMAIL', to: ['alerts@example.test'] }, { status: 'DISABLED' }),
      },
      {
        name: 'type-mismatch', channelId: 'database-type-mismatch', channelType: 'PUSHOVER' as const,
        setup: () => seedDatabaseChannel('database-type-mismatch', { type: 'EMAIL', to: ['alerts@example.test'] }),
      },
      {
        name: 'invalid-plaintext', channelId: 'database-invalid-plaintext', channelType: 'EMAIL' as const,
        setup: () => seedDatabaseChannel('database-invalid-plaintext', { type: 'EMAIL', to: ['alerts@example.test'] }, invalidPayload),
      },
      {
        name: 'tampered', channelId: 'database-tampered', channelType: 'EMAIL' as const,
        setup: () => seedDatabaseChannel('database-tampered', { type: 'EMAIL', to: ['alerts@example.test'] }, { ciphertext: 'AAAA' }),
      },
      {
        name: 'unknown-key', channelId: 'database-unknown-key', channelType: 'EMAIL' as const,
        setup: () => seedDatabaseChannel('database-unknown-key', { type: 'EMAIL', to: ['alerts@example.test'] }, { keyVersion: 9 }),
      },
    ]
    for (const fixture of fixtures) {
      await fixture.setup()
      const id = `job-database-${fixture.name}`
      await seedOutbox(id, {
        configSource: 'DATABASE', targetKey: `channel:${fixture.channelId}`, channelId: fixture.channelId,
        channelType: fixture.channelType, generation: fixtures.indexOf(fixture) + 1,
      })
      await runDeliverySweep({
        db: getDb(), limit: 1, now, workerId: `worker-${fixture.name}`, legacyConfig: legacyConfig(),
        keyring: fixture.keyring === null ? null : channelKeyring,
        send: async () => { throw new Error('invalid config must not dispatch') },
      })
    }

    for (const fixture of fixtures) {
      const id = `job-database-${fixture.name}`
      const observed = await attempt(id)
      expect((await outbox(id)).status).toBe('FAILED')
      expect(observed).toEqual({ resultClass: 'permanent', providerStatus: null, providerMessageId: null, sanitizedError: 'CONFIGURATION_INVALID' })
      expect(JSON.stringify(observed)).not.toContain('alerts@example.test')
      expect(JSON.stringify(observed)).not.toContain(invalidPayload.ciphertext)
    }
  })

  it('renews a short lease before a slow database configuration lookup', async () => {
    await seedDatabaseChannel('database-slow-lookup', { type: 'EMAIL', to: ['alerts@example.test'] })
    await seedOutbox('job-database-slow-lookup', { configSource: 'DATABASE', targetKey: 'channel:database-slow-lookup', channelId: 'database-slow-lookup', channelType: 'EMAIL' })
    const lookupStarted = deferred<void>()
    let sends = 0
    const first = runDeliverySweep({
      db: getDb(), limit: 1, now: new Date(), workerId: 'slow-config-worker', legacyConfig: legacyConfig(), keyring: channelKeyring,
      leaseDurationMs: 50, leaseRenewalMs: 10,
      loadDatabaseChannel: async (input) => {
        lookupStarted.resolve()
        await sleep(120)
        return getDatabaseDeliveryChannel(input)
      },
      send: async () => {
        sends += 1
        return sent()
      },
    })
    await lookupStarted.promise
    await sleep(70)
    const second = await runDeliverySweep({
      db: getDb(), limit: 1, now: new Date(), workerId: 'overlap-worker', legacyConfig: legacyConfig(), keyring: channelKeyring,
      leaseDurationMs: 50, leaseRenewalMs: 10,
      send: async () => {
        sends += 1
        return sent()
      },
    })
    await first

    expect(second.claimed).toBe(0)
    expect(sends).toBe(1)
    expect(await scalar(sql`select count(*)::int as count from delivery_attempts`)).toBe(1)
  })

  it('releases an unconfigured legacy target into the future so a drain does not churn it', async () => {
    await seedOutbox('job-unconfigured')

    const first = await runDeliverySweep({ db: getDb(), now, workerId: 'worker', legacyConfig: null })
    const row = await outbox('job-unconfigured')
    const second = await runDeliverySweep({ db: getDb(), now, workerId: 'worker', legacyConfig: null })

    expect(first).toMatchObject({ started: 0, configurationNotReady: 1 })
    expect(row.status).toBe('PENDING')
    expect(asDate(row.nextAttemptAt).getTime()).toBeGreaterThan(now.getTime())
    expect(second).toMatchObject({ claimed: 0, started: 0 })
  })

  it('renews a short lease while a slow provider is in flight so another worker cannot duplicate it', async () => {
    await seedOutbox('job-slow-lease')
    const started = deferred<void>()
    let sends = 0
    const base = new Date()
    const first = runDeliverySweep({
      db: getDb(), now: base, workerId: 'slow-worker', legacyConfig: legacyConfig(),
      leaseDurationMs: 50, leaseRenewalMs: 10,
      send: async () => {
        sends += 1
        started.resolve()
        await sleep(120)
        return sent()
      },
    })
    await started.promise
    await sleep(70)
    const currentLease = await outbox('job-slow-lease')
    expect(asDate(currentLease.leaseExpiresAt!).getTime()).toBeLessThan(base.getTime() + 500)
    await runDeliverySweep({
      db: getDb(), now: new Date(), workerId: 'overlap-worker', legacyConfig: legacyConfig(),
      leaseDurationMs: 50, leaseRenewalMs: 10,
      send: async () => {
        sends += 1
        return sent()
      },
    })
    await first

    expect(sends).toBe(1)
    expect((await outbox('job-slow-lease')).status).toBe('SENT')
  })

  it('does not lease queued jobs beyond active concurrency while another worker overlaps', async () => {
    for (let index = 0; index < 4; index += 1) await seedOutbox(`job-queued-${index}`, { generation: index + 1 })
    const initialDispatches = deferred<void>()
    let activeDispatches = 0
    const sends = new Map<string, number>()
    const send = async ({ idempotencyKey }: { idempotencyKey: string }): Promise<DeliveryAdapterResult> => {
      sends.set(idempotencyKey, (sends.get(idempotencyKey) ?? 0) + 1)
      activeDispatches += 1
      if (activeDispatches === 2) initialDispatches.resolve()
      await sleep(120)
      return sent()
    }

    const first = runDeliverySweep({
      db: getDb(), limit: 4, now: new Date(), workerId: 'first-worker', legacyConfig: legacyConfig(),
      concurrency: 2, leaseDurationMs: 50, leaseRenewalMs: 10, send,
    })
    await initialDispatches.promise
    await sleep(70)
    const second = runDeliverySweep({
      db: getDb(), limit: 4, now: new Date(), workerId: 'second-worker', legacyConfig: legacyConfig(),
      concurrency: 2, leaseDurationMs: 50, leaseRenewalMs: 10, send,
    })
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult.claimed).toBe(2)
    expect(secondResult.claimed).toBe(2)
    expect([...sends.values()]).toEqual([1, 1, 1, 1])
    expect(await scalar(sql`select count(*)::int as count from delivery_attempts`)).toBe(4)
  })

  it('uses a unique lease owner for each default worker invocation', async () => {
    await seedOutbox('job-default-worker-a')
    await seedOutbox('job-default-worker-b')
    const bothStarted = deferred<void>()
    const release = deferred<void>()
    let dispatches = 0
    const send = async (): Promise<DeliveryAdapterResult> => {
      dispatches += 1
      if (dispatches === 2) bothStarted.resolve()
      await release.promise
      return sent()
    }
    const first = runDeliverySweep({ db: getDb(), limit: 1, now: new Date(), legacyConfig: legacyConfig(), send })
    const second = runDeliverySweep({ db: getDb(), limit: 1, now: new Date(), legacyConfig: legacyConfig(), send })

    await bothStarted.promise
    expect(await scalar(sql`select count(distinct lease_token)::int as count from delivery_outbox where status = 'LEASED'`)).toBe(2)
    release.resolve()
    await Promise.all([first, second])
  })

  it('persists actual ordered provider dispatch timestamps instead of the sweep clock', async () => {
    await seedOutbox('job-real-attempt-time')
    const sweepNow = new Date(Date.now() - 60_000)

    await runDeliverySweep({
      db: getDb(), now: sweepNow, workerId: 'timing-worker', legacyConfig: legacyConfig(),
      send: async () => {
        await sleep(25)
        return sent()
      },
    })

    const timing = await attemptTiming('job-real-attempt-time')
    expect(asDate(timing.startedAt).getTime()).toBeGreaterThan(sweepNow.getTime())
    expect(asDate(timing.finishedAt).getTime()).toBeGreaterThan(asDate(timing.startedAt).getTime())
    expect(asDate(timing.createdAt)).toEqual(asDate(timing.finishedAt))
  })

  it('begins 500 actual local-provider dispatches inside 60 seconds with bounded concurrency', async () => {
    for (let index = 0; index < 500; index += 1) {
      await seedOutbox(`job-drain-${index}`, { generation: index + 1 })
    }
    const provider = await delayedProvider(50)
    const startedAt = Date.now()
    const result = await drainImmediateDeliveries({ batchSize: 100, maxJobs: 500, maxDurationMs: 45_000, sweep: ({ limit }) => runDeliverySweep({
      db: getDb(), limit, now: new Date(), workerId: `drain-${Math.random()}`,
      legacyConfig: legacyConfig(), concurrency: 25,
      send: async () => {
        await fetch(provider.url)
        return sent('local-provider')
      },
    }) })
    await provider.close()

    expect(result).toEqual({ started: 500, batches: 20 })
    expect(provider.startedAt).toHaveLength(500)
    expect(Math.max(...provider.startedAt) - startedAt).toBeLessThan(60_000)
  })
})

function legacyConfig() {
  return { type: 'PUSHOVER' as const, appToken: 'test-app-token', userKey: 'test-user-key' }
}

async function seedGraph(): Promise<void> {
  const db = getDb()
  await db.execute(sql`
    insert into support_groups (id, name, status, is_central_fallback, created_at, updated_at)
      values ('worker-group', 'Worker group', 'ACTIVE', false, ${now}, ${now})
  `)
  await db.execute(sql`
    insert into source_apps (id, slug, name, environment, status, enrollment_status, credential_mode, created_at, updated_at)
      values ('worker-app', 'worker-app', 'Worker App', 'test', 'ACTIVE', 'ACTIVE', 'PUBLIC_KEY', ${now}, ${now})
  `)
  await db.execute(sql`
    insert into feedback_tickets (id, source_app_id, external_id, kind, status, priority, title, description, raw_payload, last_synced_at, created_at, updated_at)
      values ('worker-ticket', 'worker-app', 'worker-external', 'BUG', 'NEW', 'HIGH', 'Worker failure', 'private', '{}'::jsonb, ${now}, ${now}, ${now})
  `)
  await db.execute(sql`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
      values ('worker-event', 'worker-ticket', 1, 'worker-event', '{}'::jsonb, ${now})
  `)
  await db.execute(sql`
    insert into notification_channels (id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at)
      values ('worker-channel', 'worker-group', 'Worker channel', 'PUSHOVER', 'ACTIVE', 'cipher', 'nonce', 'tag', 1, ${now}, ${now})
  `)
}

async function seedOutbox(id: string, options: {
  status?: 'PENDING' | 'LEASED'
  leaseExpiresAt?: Date
  configSource?: 'DATABASE' | 'LEGACY_ENV'
  targetKey?: string
  channelId?: string | null
  channelType?: 'EMAIL' | 'PUSHOVER' | 'WEBHOOK'
  generation?: number
} = {}): Promise<void> {
  const configSource = options.configSource ?? 'LEGACY_ENV'
  const targetKey = options.targetKey ?? 'legacy:central-pushover'
  const channelId = options.channelId ?? null
  await getDb().execute(sql`
    insert into delivery_outbox (
      id, escalation_event_id, event_key, target_key, generation, channel_id, channel_type, config_source,
      rendered_payload, status, next_attempt_at, attempt_count, lease_token, lease_expires_at, created_at, updated_at
    ) values (
      ${id}, 'worker-event', ${`event-${id}`}, ${targetKey}, ${options.generation ?? 1}, ${channelId}, ${options.channelType ?? 'PUSHOVER'}::"ChannelType", ${configSource},
      ${JSON.stringify(event)}::jsonb, ${options.status ?? 'PENDING'}::"DeliveryStatus", ${now}, 0,
      ${options.status === 'LEASED' ? 'stale-worker' : null}, ${options.leaseExpiresAt ?? null}, ${now}, ${now}
    )
  `)
}

async function seedDatabaseChannel(
  id: string,
  config: ChannelConfig,
  overrides: Partial<{ ciphertext: string; nonce: string; authTag: string; keyVersion: number; status: 'ACTIVE' | 'DISABLED' | 'UNHEALTHY' }> = {},
): Promise<void> {
  const encrypted = encryptChannelConfig(config, { channelId: id, type: config.type }, channelKeyring)
  await getDb().execute(sql`
    insert into notification_channels (
      id, group_id, name, type, status, encrypted_config, config_nonce, config_auth_tag, key_version, created_at, updated_at
    ) values (
      ${id}, 'worker-group', ${id}, ${config.type}::"ChannelType", ${overrides.status ?? 'ACTIVE'}::"ChannelStatus",
      ${overrides.ciphertext ?? encrypted.ciphertext}, ${overrides.nonce ?? encrypted.nonce}, ${overrides.authTag ?? encrypted.authTag}, ${overrides.keyVersion ?? 1}, ${now}, ${now}
    )
  `)
}

function encryptRawChannelPayload(channelId: string, type: 'EMAIL' | 'PUSHOVER' | 'WEBHOOK', plaintext: string): { ciphertext: string; nonce: string; authTag: string } {
  const nonce = Buffer.alloc(12, 7)
  const cipher = createCipheriv('aes-256-gcm', channelKeyring.keys.v1!, nonce)
  cipher.setAAD(Buffer.from(`support-tower-channel:${channelId}:${type}:v1`))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }
}

async function outbox(id: string): Promise<{ status: string; attemptCount: number; nextAttemptAt: Date; leaseExpiresAt: Date | null }> {
  const result = await getDb().execute<{ status: string; attemptCount: number; nextAttemptAt: Date; leaseExpiresAt: Date | null }>(sql`
    select status::text as status, attempt_count as "attemptCount", next_attempt_at as "nextAttemptAt", lease_expires_at as "leaseExpiresAt"
      from delivery_outbox where id = ${id}
  `)
  return result.rows[0]!
}

async function attempt(id: string): Promise<Record<string, unknown>> {
  const result = await getDb().execute<Record<string, unknown>>(sql`
    select result_class as "resultClass", provider_status as "providerStatus", provider_message_id as "providerMessageId", sanitized_error as "sanitizedError"
      from delivery_attempts where outbox_id = ${id}
  `)
  return result.rows[0]!
}

async function attemptTiming(id: string): Promise<{ startedAt: Date; finishedAt: Date; createdAt: Date }> {
  const result = await getDb().execute<{ startedAt: Date; finishedAt: Date; createdAt: Date }>(sql`
    select started_at as "startedAt", finished_at as "finishedAt", created_at as "createdAt"
      from delivery_attempts where outbox_id = ${id}
  `)
  return result.rows[0]!
}

async function outboxStatuses(): Promise<string[]> {
  const result = await getDb().execute<{ status: string }>(sql`select status::text as status from delivery_outbox order by id`)
  return result.rows.map((row) => row.status)
}

async function scalar(query: SQL): Promise<number> {
  const result = await getDb().execute<{ count: number }>(query)
  return result.rows[0]?.count ?? 0
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function sent(providerMessageId: string | null = null): DeliveryAdapterResult {
  return { result: 'sent', providerStatus: 202, providerMessageId, retryAfterMs: null, sanitizedError: null }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function delayedProvider(delayMs: number): Promise<{ url: string; startedAt: number[]; close(): Promise<void> }> {
  const startedAt: number[] = []
  const server = createServer((_request, response) => {
    startedAt.push(Date.now())
    setTimeout(() => { response.statusCode = 202; response.end() }, delayMs)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Delayed provider did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    startedAt,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
