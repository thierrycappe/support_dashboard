import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { SignJWT, importJWK } from 'jose'
import { Pool } from 'pg'

const UNIQUE_SUBMISSIONS = 500
const DUPLICATE_REPLAYS = 50
const DEFAULT_CONCURRENCY = 20
const DEFAULT_DEADLINE_MS = 8 * 60_000
const DEFAULT_MAX_RETRIES = 30
const DEFAULT_DELIVERY_WAIT_MS = 65_000
const MISSING_ATTEMPT_MS = 60_001

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
  accessToken: string
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
  const acceptedKeys = new Set(observations.filter((item) => item.result === 'created').map((item) => item.idempotencyKey))
  const duplicateReplays = observations.filter((item) => item.result === 'duplicate').length
  const failed = observations.filter((item) => item.result === 'failed').length
  return {
    submitted: observations.length,
    acceptedUnique: acceptedKeys.size,
    duplicateReplays,
    failed,
    missingReceipts: [...acceptedKeys].filter((key) => !receiptKeys.has(key)).length,
    missingDeliveryTargets: [...acceptedKeys].filter((key) => !targetKeys.has(key)).length,
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
  let cursor = 0
  let throttledRetries = 0
  const observations: LoadObservation[] = []
  const fetchImpl = config.fetchImpl ?? fetch
  const wait = config.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const workers = Array.from({ length: Math.min(config.concurrency, plan.length) }, async () => {
    while (cursor < plan.length) {
      const item = plan[cursor++]
      if (!item) break
      if (Date.now() - startedAt >= config.deadlineMs) {
        observations.push({ idempotencyKey: item.idempotencyKey, result: 'failed', status: 0, intakeMs: 0 })
        continue
      }
      let retries = 0
      while (true) {
        const attemptStartedAt = performance.now()
        const abortController = new AbortController()
        const remainingMs = Math.max(1, config.deadlineMs - (Date.now() - startedAt))
        const abortTimer = setTimeout(() => abortController.abort(), remainingMs)
        let response: Response
        try {
          response = await fetchImpl(`${config.baseUrl}/api/v1/escalations`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${config.accessToken}`,
              'content-type': 'application/json',
              'idempotency-key': item.idempotencyKey,
              'x-correlation-id': item.idempotencyKey,
            },
            body: JSON.stringify(escalationPayload(item)),
            signal: abortController.signal,
          })
        } catch {
          observations.push({ idempotencyKey: item.idempotencyKey, result: 'failed', status: 0, intakeMs: Math.round(performance.now() - attemptStartedAt) })
          break
        } finally {
          clearTimeout(abortTimer)
        }
        const intakeMs = Math.round(performance.now() - attemptStartedAt)
        if (response.status === 429 && retries < config.maxRetries && Date.now() - startedAt < config.deadlineMs) {
          retries += 1
          throttledRetries += 1
          await wait(Math.min(retryAfterMs(response), Math.max(0, config.deadlineMs - (Date.now() - startedAt))))
          continue
        }
        const body = await readJson(response)
        const result = response.status === 201 && body.result === 'created'
          ? 'created'
          : response.status === 200 && body.result === 'duplicate' ? 'duplicate' : 'failed'
        observations.push({ idempotencyKey: item.idempotencyKey, result, status: response.status, intakeMs })
        break
      }
    }
  })
  await Promise.all(workers)
  return { observations, throttledRetries, durationMs: Date.now() - startedAt }
}

async function main(): Promise<void> {
  const config = resolveLoadTestConfig(process.env)
  const runId = resolveRunId(process.env.LOAD_TEST_RUN_ID)
  const pool = new Pool({ connectionString: config.databaseUrl, max: 4 })
  try {
    await assertDedicatedFixture(pool, config)
    // An explicit run id is deliberately reusable for deterministic CI. Clear
    // an interrupted prior run before submission so stale receipts cannot be
    // misreported as this run's controlled duplicate replays.
    await cleanupFixtureRun(pool, config.appId, runId)
    const accessToken = await requestAccessToken(config)
    const plan = buildLoadPlan(runId)
    const submitted = await runSubmissions(plan, { ...config, accessToken })
    const verified = await verifyPersistence(pool, config.appId, plan.slice(0, UNIQUE_SUBMISSIONS).map((item) => item.idempotencyKey), submitted.observations, config.deliveryWaitMs)
    const summary = summarizeLoad({ observations: submitted.observations, ...verified })
    const failureStatuses = submitted.observations.filter((item) => item.result === 'failed').reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1
      return counts
    }, {})
    process.stdout.write(`${JSON.stringify({
      ...summary,
      throttledRetries: submitted.throttledRetries,
      durationMs: submitted.durationMs,
      deadlineMs: config.deadlineMs,
      maxRetries: config.maxRetries,
      failureStatuses,
    }, null, 2)}\n`)
    assertLoadSummary(summary)
  } finally {
    await cleanupFixtureRun(pool, config.appId, runId)
    await pool.end()
  }
}

async function requestAccessToken(config: LoadTestConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1_000)
  const key = await importJWK(config.privateJwk, 'EdDSA')
  const audience = `${config.baseUrl}/api/v1/service-tokens`
  const assertion = await new SignJWT({ scope: ['escalations:write'] })
    .setProtectedHeader({ alg: 'EdDSA', kid: config.credentialId })
    .setIssuer(config.appId).setSubject(config.appId).setAudience(audience)
    .setIssuedAt(now).setExpirationTime(now + 60).setJti(randomUUID()).sign(key)
  const response = await fetch(`${config.baseUrl}/api/v1/service-tokens`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': randomUUID() }, body: JSON.stringify({ clientAssertion: assertion }),
  })
  const body = await readJson(response)
  if (!response.ok || typeof body.accessToken !== 'string') throw new Error(`Service token request failed with ${response.status}`)
  return body.accessToken
}

async function assertDedicatedFixture(pool: Pool, config: LoadTestConfig): Promise<void> {
  const result = await pool.query<{ environment: string; status: string; enrollment_status: string; credential_mode: string }>(`
    select environment, status::text, enrollment_status::text, credential_mode::text
      from source_apps where id = $1 and slug like 'load-test-%'
  `, [config.appId])
  const fixture = result.rows[0]
  if (!fixture || fixture.environment !== 'test' || fixture.status !== 'ACTIVE' || fixture.enrollment_status !== 'ACTIVE' || fixture.credential_mode !== 'PUBLIC_KEY') {
    throw new Error('LOAD_TEST_APP_ID must identify a dedicated active enrolled load-test fixture')
  }
}

async function verifyPersistence(pool: Pool, appId: string, expectedKeys: string[], observations: LoadObservation[], waitMs: number): Promise<{
  receiptKeys: Set<string>
  targetKeys: Set<string>
  firstAttemptMs: number[]
}> {
  const acceptedCount = new Set(observations.filter((item) => item.result === 'created').map((item) => item.idempotencyKey)).size
  const deadline = Date.now() + waitMs
  while (true) {
    const rows = await queryPersistence(pool, appId, expectedKeys)
    const final = Date.now() >= deadline
    const snapshot = persistenceSnapshot(rows, acceptedCount, final)
    if (snapshot.receiptKeys.size === acceptedCount && snapshot.targetKeys.size === acceptedCount && snapshot.firstAttemptMs.length === acceptedCount) return snapshot
    if (final) return snapshot
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
}

interface PersistenceRow {
  idempotency_key: string
  target_count: string
  first_attempt_ms: string | null
}

async function queryPersistence(pool: Pool, appId: string, expectedKeys: string[]): Promise<PersistenceRow[]> {
  const result = await pool.query<PersistenceRow>(`
    select receipt.idempotency_key,
           count(distinct outbox.id)::text as target_count,
           extract(epoch from (min(attempt.started_at) - receipt.created_at)) * 1000 as first_attempt_ms
      from ingest_receipts receipt
      left join escalation_events event on event.ticket_id = receipt.ticket_id
      left join delivery_outbox outbox on outbox.escalation_event_id = event.id
      left join delivery_attempts attempt on attempt.outbox_id = outbox.id
     where receipt.source_app_id = $1 and receipt.idempotency_key = any($2::text[])
     group by receipt.idempotency_key, receipt.created_at
  `, [appId, expectedKeys])
  return result.rows
}

export function persistenceSnapshot(rows: PersistenceRow[], acceptedCount: number, final: boolean): {
  receiptKeys: Set<string>
  targetKeys: Set<string>
  firstAttemptMs: number[]
} {
  const receiptKeys = new Set(rows.map((row) => row.idempotency_key))
  const targetKeys = new Set(rows.filter((row) => Number(row.target_count) > 0).map((row) => row.idempotency_key))
  let firstAttemptMs = rows.flatMap((row) => row.first_attempt_ms === null ? [] : [Math.max(0, Number(row.first_attempt_ms))])
  if (final && acceptedCount > firstAttemptMs.length) {
    // One absent attempt is a hard failure. A single sentinel prevents a small
    // number of missing attempts from disappearing below the 95th percentile.
    firstAttemptMs = [MISSING_ATTEMPT_MS]
  }
  return { receiptKeys, targetKeys, firstAttemptMs }
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
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1_000, 0), 60_000) : 1_000
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown> } catch { return {} }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Load verification failed'}\n`)
    process.exitCode = 1
  })
}
