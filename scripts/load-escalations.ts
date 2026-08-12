import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { SignJWT, calculateJwkThumbprint, importJWK } from 'jose'
import { Pool } from 'pg'

const UNIQUE_SUBMISSIONS = 500
const DUPLICATE_REPLAYS = 50
const DEFAULT_CONCURRENCY = 20
const DEFAULT_DEADLINE_MS = 8 * 60_000
const DEFAULT_MAX_RETRIES = 30
const DEFAULT_DELIVERY_WAIT_MS = 65_000
const MISSING_ATTEMPT_MS = 60_001
const REQUEST_TIMEOUT_MS = 30_000
const TOKEN_REFRESH_SKEW_MS = 30_000

export interface LoadSummary {
  submitted: number
  acceptedUnique: number
  duplicateReplays: number
  failed: number
  missingReceipts: number
  missingDeliveryTargets: number
  intakeP95Ms: number
  firstAttemptP95Ms: number
}

export interface LoadPlanItem {
  idempotencyKey: string
  externalId: string
  replay: boolean
}

export interface LoadObservation {
  idempotencyKey: string
  replay: boolean
  result: 'created' | 'duplicate' | 'failed'
  status: number
  intakeMs: number
}

export interface LoadTestConfig {
  baseUrl: string
  databaseUrl: string
  appId: string
  credentialId: string
  privateJwk: Record<string, unknown>
  concurrency: number
  deadlineMs: number
  maxRetries: number
  deliveryWaitMs: number
}

export interface SubmissionConfig {
  baseUrl: string
  accessToken?: string
  getAccessToken?: (timeoutMs?: number) => Promise<string>
  concurrency: number
  deadlineMs: number
  maxRetries: number
  fetchImpl?: typeof fetch
  wait?: (milliseconds: number) => Promise<void>
}

export function percentile(samples: number[], value: number): number {
  if (samples.length === 0) return 0
  const ordered = [...samples].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil((Math.min(Math.max(value, 0), 100) / 100) * ordered.length))
  return ordered[rank - 1]!
}

export function buildLoadPlan(runId: string): LoadPlanItem[] {
  const unique = Array.from({ length: UNIQUE_SUBMISSIONS }, (_, index) => {
    const identity = `load-${runId}-${String(index).padStart(4, '0')}`
    return { idempotencyKey: identity, externalId: identity, replay: false }
  })
  return [...unique, ...unique.slice(0, DUPLICATE_REPLAYS).map((item) => ({ ...item, replay: true }))]
}

export function summarizeLoad({
  observations,
  receiptKeys,
  targetKeys,
  firstAttemptMs,
}: {
  observations: LoadObservation[]
  receiptKeys: Set<string>
  targetKeys: Set<string>
  firstAttemptMs: number[]
}): LoadSummary {
  const acceptedUnique = new Set(observations.filter((item) => item.result === 'created' && !item.replay).map((item) => item.idempotencyKey))
  const duplicateReplays = observations.filter((item) => item.result === 'duplicate' && item.replay).length
  const failed = observations.filter((item) => item.result === 'failed'
    || (item.replay && item.result !== 'duplicate')
    || (!item.replay && item.result !== 'created')).length
  return {
    submitted: observations.length,
    acceptedUnique: acceptedUnique.size,
    duplicateReplays,
    failed,
    missingReceipts: [...acceptedUnique].filter((key) => !receiptKeys.has(key)).length,
    missingDeliveryTargets: [...acceptedUnique].filter((key) => !targetKeys.has(key)).length,
    intakeP95Ms: percentile(observations.filter((item) => item.result !== 'failed').map((item) => item.intakeMs), 95),
    firstAttemptP95Ms: percentile(firstAttemptMs, 95),
  }
}

export function assertLoadSummary(summary: LoadSummary): void {
  const failures: string[] = []
  if (summary.submitted !== 550) failures.push(`submitted=${summary.submitted}, expected 550`)
  if (summary.acceptedUnique !== 500) failures.push(`acceptedUnique=${summary.acceptedUnique}, expected 500`)
  if (summary.duplicateReplays !== 50) failures.push(`duplicateReplays=${summary.duplicateReplays}, expected 50`)
  if (summary.failed !== 0) failures.push(`failed=${summary.failed}, expected 0`)
  if (summary.missingReceipts !== 0) failures.push(`missingReceipts=${summary.missingReceipts}, expected 0`)
  if (summary.missingDeliveryTargets !== 0) failures.push(`missingDeliveryTargets=${summary.missingDeliveryTargets}, expected 0`)
  if (summary.intakeP95Ms > 2_000) failures.push(`intakeP95Ms=${summary.intakeP95Ms}, threshold 2000`)
  if (summary.firstAttemptP95Ms > 60_000) failures.push(`firstAttemptP95Ms=${summary.firstAttemptP95Ms}, threshold 60000`)
  if (failures.length > 0) throw new Error(`Load verification failed: ${failures.join('; ')}`)
}

export function resolveLoadTestConfig(env: Record<string, string | undefined>): LoadTestConfig {
  const base = env.LOAD_TEST_BASE_URL?.trim()
  const databaseUrl = env.LOAD_TEST_DATABASE_URL?.trim()
  if (!base) throw new Error('LOAD_TEST_BASE_URL is required')
  if (!databaseUrl) throw new Error('LOAD_TEST_DATABASE_URL is required')
  const baseUrl = safeBaseUrl(base, env.ALLOW_SUPPORT_LOAD_TEST === '1')
  const database = new URL(databaseUrl)
  if (!['localhost', '127.0.0.1', '::1'].includes(database.hostname) && env.ALLOW_SUPPORT_LOAD_TEST !== '1') {
    throw new Error('Refusing a non-local load test database without ALLOW_SUPPORT_LOAD_TEST=1')
  }
  const appId = required(env.LOAD_TEST_APP_ID, 'LOAD_TEST_APP_ID')
  const credentialId = required(env.LOAD_TEST_CREDENTIAL_ID, 'LOAD_TEST_CREDENTIAL_ID')
  const privateJwk = parsePrivateJwk(required(env.LOAD_TEST_PRIVATE_JWK, 'LOAD_TEST_PRIVATE_JWK'))
  return {
    baseUrl,
    databaseUrl,
    appId,
    credentialId,
    privateJwk,
    concurrency: boundedInteger(env.LOAD_TEST_CONCURRENCY, DEFAULT_CONCURRENCY, 1, DEFAULT_CONCURRENCY),
    deadlineMs: boundedInteger(env.LOAD_TEST_DEADLINE_MS, DEFAULT_DEADLINE_MS, 1_000, 15 * 60_000),
    maxRetries: boundedInteger(env.LOAD_TEST_MAX_RETRIES, DEFAULT_MAX_RETRIES, 0, 30),
    deliveryWaitMs: boundedInteger(env.LOAD_TEST_DELIVERY_WAIT_MS, DEFAULT_DELIVERY_WAIT_MS, 1_000, 120_000),
  }
}

export async function runSubmissions(plan: LoadPlanItem[], config: SubmissionConfig): Promise<{
  observations: LoadObservation[]
  throttledRetries: number
  durationMs: number
}> {
  const startedAt = Date.now()
  let throttledRetries = 0
  const observations: LoadObservation[] = []
  const fetchImpl = config.fetchImpl ?? fetch
  const wait = config.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const getAccessToken: ((timeoutMs?: number) => Promise<string>) | undefined = config.getAccessToken
    ?? (config.accessToken ? async () => config.accessToken! : undefined)
  if (!getAccessToken) throw new Error('An access token provider is required')
  const runPhase = async (items: LoadPlanItem[]) => {
    let cursor = 0
    const workers = Array.from({ length: Math.min(config.concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++]
        if (!item) break
        if (Date.now() - startedAt >= config.deadlineMs) {
          observations.push({ idempotencyKey: item.idempotencyKey, replay: item.replay, result: 'failed', status: 0, intakeMs: 0 })
          continue
        }
        let retries = 0
        while (true) {
          if (Date.now() - startedAt >= config.deadlineMs) {
            observations.push({ idempotencyKey: item.idempotencyKey, replay: item.replay, result: 'failed', status: 0, intakeMs: 0 })
            break
          }
          const attemptStartedAt = performance.now()
          const abortController = new AbortController()
          const remainingMs = Math.max(1, config.deadlineMs - (Date.now() - startedAt))
          const abortTimer = setTimeout(() => abortController.abort(), remainingMs)
          try {
            const accessToken = await getAccessToken(remainingMs)
            const response = await fetchImpl(`${config.baseUrl}/api/v1/escalations`, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json',
                'idempotency-key': item.idempotencyKey,
                'x-correlation-id': item.idempotencyKey,
              },
              body: JSON.stringify(escalationPayload(item)),
              signal: abortController.signal,
            })
            const body = await readJson(response, abortController.signal)
            const intakeMs = Math.round(performance.now() - attemptStartedAt)
            if (response.status === 429 && retries < config.maxRetries && Date.now() - startedAt < config.deadlineMs) {
              retries += 1
              throttledRetries += 1
              await wait(Math.min(retryAfterMs(response), Math.max(0, config.deadlineMs - (Date.now() - startedAt))))
              continue
            }
            const result = response.status === 201 && body.result === 'created'
              ? 'created'
              : response.status === 200 && body.result === 'duplicate' ? 'duplicate' : 'failed'
            observations.push({ idempotencyKey: item.idempotencyKey, replay: item.replay, result, status: response.status, intakeMs })
            break
          } catch {
            observations.push({ idempotencyKey: item.idempotencyKey, replay: item.replay, result: 'failed', status: 0, intakeMs: Math.round(performance.now() - attemptStartedAt) })
            break
          } finally {
            clearTimeout(abortTimer)
          }
        }
      }
    })
    await Promise.all(workers)
  }
  await runPhase(plan.filter((item) => !item.replay))
  await runPhase(plan.filter((item) => item.replay))
  return { observations, throttledRetries, durationMs: Date.now() - startedAt }
}

async function main(): Promise<void> {
  const config = resolveLoadTestConfig(process.env)
  const runId = resolveRunId(process.env.LOAD_TEST_RUN_ID)
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 4,
    connectionTimeoutMillis: Math.min(10_000, config.deadlineMs),
    statement_timeout: Math.min(REQUEST_TIMEOUT_MS, config.deadlineMs),
  })
  try {
    await withValidatedFixture(
      () => assertDedicatedFixture(pool, config),
      async (fixture) => {
        // An explicit run id is deliberately reusable for deterministic CI.
        await cleanupFixtureRun(pool, config.appId, runId)
        const getAccessToken = createAccessTokenProvider({ requestToken: (timeoutMs) => requestAccessToken(config, timeoutMs) })
        const plan = buildLoadPlan(runId)
        const submitted = await runSubmissions(plan, { ...config, getAccessToken })
        const expectedKeys = plan.slice(0, UNIQUE_SUBMISSIONS).map((item) => item.idempotencyKey)
        const verified = await verifyPersistence(pool, config.appId, expectedKeys, fixture.expectedTargetKeys, submitted.observations, config.deliveryWaitMs)
        const summary = summarizeLoad({ observations: submitted.observations, ...verified })
        const failureStatuses = submitted.observations.filter((item) => item.result === 'failed').reduce<Record<string, number>>((counts, item) => {
          counts[item.status] = (counts[item.status] ?? 0) + 1
          return counts
        }, {})
        process.stdout.write(`${JSON.stringify({
          ...summary,
          expectedTargetKeys: [...fixture.expectedTargetKeys].sort(),
          throttledRetries: submitted.throttledRetries,
          durationMs: submitted.durationMs,
          deadlineMs: config.deadlineMs,
          maxRetries: config.maxRetries,
          failureStatuses,
        }, null, 2)}\n`)
        assertLoadSummary(summary)
      },
      () => cleanupFixtureRun(pool, config.appId, runId),
    )
  } finally {
    await pool.end()
  }
}

async function requestAccessToken(config: LoadTestConfig, timeoutMs: number): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const now = Math.floor(Date.now() / 1_000)
  const key = await importJWK(config.privateJwk, 'EdDSA')
  const audience = `${config.baseUrl}/api/v1/service-tokens`
  const assertion = await new SignJWT({ scope: ['escalations:write'] })
    .setProtectedHeader({ alg: 'EdDSA', kid: config.credentialId })
    .setIssuer(config.appId).setSubject(config.appId).setAudience(audience)
    .setIssuedAt(now).setExpirationTime(now + 60).setJti(randomUUID()).sign(key)
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), Math.max(1, Math.min(REQUEST_TIMEOUT_MS, config.deadlineMs, timeoutMs)))
  try {
    const response = await fetch(`${config.baseUrl}/api/v1/service-tokens`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': randomUUID() }, body: JSON.stringify({ clientAssertion: assertion }), signal: abortController.signal,
    })
    const body = await readJson(response, abortController.signal)
    if (!response.ok || typeof body.accessToken !== 'string' || !Number.isInteger(body.expiresIn) || Number(body.expiresIn) <= 0) {
      throw new Error(`Service token request failed with ${response.status}`)
    }
    return { accessToken: body.accessToken, expiresInSeconds: Number(body.expiresIn) }
  } finally {
    clearTimeout(timer)
  }
}

interface ValidatedFixture {
  expectedTargetKeys: Set<string>
}

async function assertDedicatedFixture(pool: Pool, config: LoadTestConfig): Promise<ValidatedFixture> {
  const privateKeyThumbprint = await calculateJwkThumbprint(
    config.privateJwk as Parameters<typeof calculateJwkThumbprint>[0],
    'sha256',
  )
  const result = await pool.query<{ environment: string; status: string; enrollment_status: string; credential_mode: string }>(`
    select app.environment, app.status::text, app.enrollment_status::text, app.credential_mode::text
      from source_apps app
      join app_credentials credential
        on credential.source_app_id = app.id
       and credential.id = $2
       and credential.public_key_thumbprint = $3
       and credential.status = 'ACTIVE'
       and credential.valid_from <= now()
       and (credential.valid_until is null or credential.valid_until > now())
       and credential.revoked_at is null
     where app.id = $1 and app.slug like 'load-test-%'
  `, [config.appId, config.credentialId, privateKeyThumbprint])
  const fixture = result.rows[0]
  if (!fixture || fixture.environment !== 'test' || fixture.status !== 'ACTIVE' || fixture.enrollment_status !== 'ACTIVE' || fixture.credential_mode !== 'PUBLIC_KEY') {
    throw new Error('LOAD_TEST_APP_ID must identify a dedicated active enrolled load-test fixture')
  }
  const targets = await pool.query<{ target_key: string }>(`
    select 'channel:' || channel.id as target_key
      from source_apps app
      join support_groups group_ on group_.id = app.technical_group_id and group_.status = 'ACTIVE'
      join notification_channels channel on channel.group_id = group_.id and channel.status = 'ACTIVE'
      left join app_notification_policies policy on policy.source_app_id = app.id
     where app.id = $1
       and case coalesce(policy.minimum_priority::text, 'MEDIUM')
             when 'LOW' then 1 when 'MEDIUM' then 2 when 'HIGH' then 3 when 'URGENT' then 4
           end <= 3
     order by target_key
  `, [config.appId])
  const expectedTargetKeys = new Set(targets.rows.map((row) => row.target_key))
  if (expectedTargetKeys.size === 0) throw new Error('LOAD_TEST_APP_ID must have at least one active dedicated database target for HIGH escalations')
  return { expectedTargetKeys }
}

export async function withValidatedFixture<TFixture, TResult>(
  validate: () => Promise<TFixture>,
  work: (fixture: TFixture) => Promise<TResult>,
  cleanup: () => Promise<void>,
): Promise<TResult> {
  const fixture = await validate()
  try {
    return await work(fixture)
  } finally {
    await cleanup()
  }
}

export function createAccessTokenProvider({
  requestToken,
  now = Date.now,
}: {
  requestToken: (timeoutMs: number) => Promise<{ accessToken: string; expiresInSeconds: number }>
  now?: () => number
}): (timeoutMs?: number) => Promise<string> {
  let cached: { accessToken: string; refreshAt: number } | undefined
  let pending: Promise<{ accessToken: string; refreshAt: number }> | undefined
  return async (timeoutMs = REQUEST_TIMEOUT_MS) => {
    const current = now()
    if (cached && current < cached.refreshAt) return cached.accessToken
    pending ??= requestToken(timeoutMs).then(({ accessToken, expiresInSeconds }) => ({
      accessToken,
      refreshAt: now() + Math.max(0, expiresInSeconds * 1_000 - TOKEN_REFRESH_SKEW_MS),
    })).finally(() => { pending = undefined })
    cached = await pending
    return cached.accessToken
  }
}

async function verifyPersistence(pool: Pool, appId: string, expectedKeys: string[], expectedTargetKeys: Set<string>, observations: LoadObservation[], waitMs: number): Promise<{
  receiptKeys: Set<string>
  targetKeys: Set<string>
  firstAttemptMs: number[]
}> {
  const acceptedCount = new Set(observations.filter((item) => item.result === 'created').map((item) => item.idempotencyKey)).size
  const deadline = Date.now() + waitMs
  while (true) {
    const rows = await queryPersistence(pool, appId, expectedKeys)
    const final = Date.now() >= deadline
    const acceptedKeys = new Set(observations.filter((item) => item.result === 'created' && !item.replay).map((item) => item.idempotencyKey))
    const snapshot = persistenceSnapshot(rows, acceptedKeys, expectedTargetKeys, final)
    if (snapshot.receiptKeys.size === acceptedCount && snapshot.validDeliveryKeys.size === acceptedCount && snapshot.firstAttemptMs.length === acceptedCount * expectedTargetKeys.size) return {
      receiptKeys: snapshot.receiptKeys,
      targetKeys: snapshot.validDeliveryKeys,
      firstAttemptMs: snapshot.firstAttemptMs,
    }
    if (final) return {
      receiptKeys: snapshot.receiptKeys,
      targetKeys: snapshot.validDeliveryKeys,
      firstAttemptMs: snapshot.firstAttemptMs,
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
}

interface PersistenceRow {
  idempotency_key: string
  event_count: string
  target_key: string | null
  first_attempt_ms: string | null
}

async function queryPersistence(pool: Pool, appId: string, expectedKeys: string[]): Promise<PersistenceRow[]> {
  const result = await pool.query<PersistenceRow>(`
    select receipt.idempotency_key,
           event_counts.event_count::text,
           outbox.target_key,
           extract(epoch from (min(attempt.started_at) - receipt.created_at)) * 1000 as first_attempt_ms
      from ingest_receipts receipt
      left join lateral (
        select count(*) as event_count
          from escalation_events counted_event
         where counted_event.ticket_id = receipt.ticket_id
      ) event_counts on true
      left join escalation_events event on event.ticket_id = receipt.ticket_id
      left join delivery_outbox outbox on outbox.escalation_event_id = event.id
      left join delivery_attempts attempt on attempt.outbox_id = outbox.id
     where receipt.source_app_id = $1 and receipt.idempotency_key = any($2::text[])
     group by receipt.id, receipt.idempotency_key, receipt.created_at, event_counts.event_count, outbox.target_key
  `, [appId, expectedKeys])
  return result.rows
}

export function persistenceSnapshot(rows: PersistenceRow[], acceptedKeys: Set<string>, expectedTargetKeys: Set<string>, final: boolean): {
  receiptKeys: Set<string>
  validDeliveryKeys: Set<string>
  firstAttemptMs: number[]
} {
  const receiptKeys = new Set(rows.map((row) => row.idempotency_key))
  const byKey = rows.reduce<Map<string, PersistenceRow[]>>((grouped, row) => {
    const existing = grouped.get(row.idempotency_key)
    if (existing) existing.push(row)
    else grouped.set(row.idempotency_key, [row])
    return grouped
  }, new Map())
  const validDeliveryKeys = new Set([...acceptedKeys].filter((key) => {
    const keyRows = byKey.get(key) ?? []
    const actualTargets = new Set(keyRows.flatMap((row) => row.target_key === null ? [] : [row.target_key]))
    return keyRows.every((row) => Number(row.event_count) === 1)
      && actualTargets.size === expectedTargetKeys.size
      && [...expectedTargetKeys].every((target) => actualTargets.has(target))
      && keyRows.every((row) => row.target_key === null || row.first_attempt_ms !== null)
  }))
  let firstAttemptMs = rows.flatMap((row) => row.first_attempt_ms === null ? [] : [Math.max(0, Number(row.first_attempt_ms))])
  const expectedAttempts = acceptedKeys.size * expectedTargetKeys.size
  if (final && (validDeliveryKeys.size < acceptedKeys.size || firstAttemptMs.length !== expectedAttempts)) {
    firstAttemptMs = [MISSING_ATTEMPT_MS]
  }
  return { receiptKeys, validDeliveryKeys, firstAttemptMs }
}

async function cleanupFixtureRun(pool: Pool, appId: string, runId?: string): Promise<void> {
  if (!runId) return
  const prefix = `load-${runId}-%`
  await pool.query(`
    delete from delivery_attempts attempt
     using delivery_outbox outbox, escalation_events event, feedback_tickets ticket
     where attempt.outbox_id = outbox.id
       and outbox.escalation_event_id = event.id
       and event.ticket_id = ticket.id
       and ticket.source_app_id = $1
       and ticket.external_id like $2
  `, [appId, prefix])
  await pool.query('delete from feedback_tickets where source_app_id = $1 and external_id like $2', [appId, prefix])
  await pool.query('delete from ingest_receipts where source_app_id = $1 and idempotency_key like $2', [appId, prefix])
  await pool.query('delete from service_rate_limit_buckets where subject = $1', [appId])
}

function escalationPayload(item: LoadPlanItem) {
  const timestamp = '2026-08-13T00:00:00.000Z'
  return {
    schemaVersion: 1, externalId: item.externalId, classification: 'BUG', status: 'NEW', priority: 'HIGH',
    title: `Load escalation ${item.externalId}`, description: 'Deterministic peak-day load verification.', sourceUrl: null,
    triage: { ownerRef: 'load-test-owner', ownerName: 'Load test owner', escalatedAt: timestamp },
    reporter: { name: null, email: null, sourceId: null }, browserInfo: null, markdownSpec: null, transcript: null,
    remoteCreatedAt: timestamp, remoteUpdatedAt: timestamp, metadata: { loadTest: true },
  }
}

function safeBaseUrl(value: string, allowed: boolean): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('LOAD_TEST_BASE_URL must be an origin')
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!local && !allowed) throw new Error('Refusing a production-looking load test host without ALLOW_SUPPORT_LOAD_TEST=1')
  return url.origin
}

function parsePrivateJwk(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('d' in parsed)) throw new Error('invalid')
    return parsed as Record<string, unknown>
  } catch { throw new Error('LOAD_TEST_PRIVATE_JWK must be a private JWK') }
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

export function resolveRunId(value?: string): string {
  const runId = value?.trim() || randomUUID().slice(0, 12)
  if (!/^[A-Za-z0-9-]{1,40}$/.test(runId)) throw new Error('LOAD_TEST_RUN_ID must contain only letters, numbers, and hyphens')
  return runId
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('Invalid load test bound')
  return parsed
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after')
  if (header === null || header.trim() === '') return 1_000
  const seconds = Number(header)
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1_000, 0), 60_000) : 1_000
}

async function readJson(response: Response, signal?: AbortSignal): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown> } catch (error) {
    if (signal?.aborted) throw error
    return {}
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Load verification failed'}\n`)
    process.exitCode = 1
  })
}
