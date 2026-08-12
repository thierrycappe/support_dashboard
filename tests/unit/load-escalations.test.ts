import { describe, expect, it } from 'vitest'
import {
  assertLoadSummary,
  buildLoadPlan,
  createAccessTokenProvider,
  percentile,
  persistenceSnapshot,
  resolveLoadTestConfig,
  resolveRunId,
  runSubmissions,
  withValidatedFixture,
  summarizeLoad,
  type LoadObservation,
} from '@/scripts/load-escalations'

describe('support escalation burst harness', () => {
  it('uses a nearest-rank percentile for literal latency samples', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200], 95)).toBe(190)
    expect(percentile([7], 95)).toBe(7)
    expect(percentile([], 95)).toBe(0)
  })

  it('builds exactly 500 deterministic unique submissions and 50 controlled replays', () => {
    const plan = buildLoadPlan('run-fixed')
    expect(plan).toHaveLength(550)
    expect(new Set(plan.map((item) => item.idempotencyKey))).toHaveLength(500)
    expect(plan.filter((item) => item.replay)).toHaveLength(50)
    expect(plan[500]).toMatchObject({ idempotencyKey: 'load-run-fixed-0000', externalId: 'load-run-fixed-0000', replay: true })
  })

  it('accepts only cleanup-safe run identifiers', () => {
    expect(resolveRunId('run-fixed')).toBe('run-fixed')
    expect(() => resolveRunId('run_%')).toThrow('LOAD_TEST_RUN_ID')
    expect(() => resolveRunId('../shared')).toThrow('LOAD_TEST_RUN_ID')
  })

  it('makes absent delivery attempts fail visibly after bounded polling', () => {
    const snapshot = persistenceSnapshot([
      { idempotency_key: 'one', event_count: '1', target_key: 'channel:load', first_attempt_ms: '25' },
      { idempotency_key: 'two', event_count: '1', target_key: 'channel:load', first_attempt_ms: null },
    ], new Set(['one', 'two']), new Set(['channel:load']), true)
    expect(snapshot.receiptKeys).toEqual(new Set(['one', 'two']))
    expect(snapshot.validDeliveryKeys).toEqual(new Set(['one']))
    expect(snapshot.firstAttemptMs).toEqual([60_001])
  })

  it('rejects extra events and any missing or unexpected fixture target', () => {
    const snapshot = persistenceSnapshot([
      { idempotency_key: 'one', event_count: '2', target_key: 'channel:load', first_attempt_ms: '25' },
      { idempotency_key: 'one', event_count: '2', target_key: 'channel:unexpected', first_attempt_ms: '30' },
      { idempotency_key: 'two', event_count: '1', target_key: 'channel:load', first_attempt_ms: '35' },
    ], new Set(['one', 'two']), new Set(['channel:load']), true)
    expect(snapshot.validDeliveryKeys).toEqual(new Set(['two']))
    expect(snapshot.firstAttemptMs).toEqual([60_001])
  })

  it('accounts for unique receipts, duplicate responses, and missing delivery targets exactly', () => {
    const observations: LoadObservation[] = [
      { idempotencyKey: 'one', replay: false, result: 'created', status: 201, intakeMs: 110 },
      { idempotencyKey: 'two', replay: false, result: 'created', status: 201, intakeMs: 90 },
      { idempotencyKey: 'one', replay: true, result: 'duplicate', status: 200, intakeMs: 70 },
      { idempotencyKey: 'bad', replay: false, result: 'failed', status: 503, intakeMs: 60 },
    ]
    expect(summarizeLoad({ observations, receiptKeys: new Set(['one']), targetKeys: new Set(['one']), firstAttemptMs: [800] })).toEqual({
      submitted: 4, acceptedUnique: 2, duplicateReplays: 1, failed: 1, missingReceipts: 1,
      missingDeliveryTargets: 1, intakeP95Ms: 110, firstAttemptP95Ms: 800,
    })
  })

  it('counts a created replay or duplicate first submission as a semantic failure', () => {
    const observations: LoadObservation[] = [
      { idempotencyKey: 'one', replay: false, result: 'duplicate', status: 200, intakeMs: 20 },
      { idempotencyKey: 'one', replay: true, result: 'created', status: 201, intakeMs: 20 },
    ]
    expect(summarizeLoad({ observations, receiptKeys: new Set(['one']), targetKeys: new Set(['one']), firstAttemptMs: [1] }))
      .toMatchObject({ acceptedUnique: 0, duplicateReplays: 0, failed: 2 })
  })

  it.each([
    ['missing receipts', { missingReceipts: 1 }],
    ['wrong unique count', { acceptedUnique: 499 }],
    ['wrong duplicate count', { duplicateReplays: 49 }],
    ['failed requests', { failed: 1 }],
    ['missing targets', { missingDeliveryTargets: 1 }],
    ['slow intake', { intakeP95Ms: 2_001 }],
    ['slow first attempt', { firstAttemptP95Ms: 60_001 }],
  ] as const)('fails the run for %s', (_label, override) => {
    const summary = { submitted: 550, acceptedUnique: 500, duplicateReplays: 50, failed: 0, missingReceipts: 0, missingDeliveryTargets: 0, intakeP95Ms: 1_999, firstAttemptP95Ms: 59_999, ...override }
    expect(() => assertLoadSummary(summary)).toThrow()
  })

  it('accepts only an exact successful summary at the latency boundaries', () => {
    expect(() => assertLoadSummary({
      submitted: 550, acceptedUnique: 500, duplicateReplays: 50, failed: 0, missingReceipts: 0,
      missingDeliveryTargets: 0, intakeP95Ms: 2_000, firstAttemptP95Ms: 60_000,
    })).not.toThrow()
  })

  it('requires explicit local endpoints and refuses production-looking hosts without an override', () => {
    expect(() => resolveLoadTestConfig({})).toThrow('LOAD_TEST_BASE_URL')
    expect(() => resolveLoadTestConfig({ LOAD_TEST_BASE_URL: 'https://support.example.com', LOAD_TEST_DATABASE_URL: 'postgresql://test' })).toThrow('Refusing')
    expect(resolveLoadTestConfig({
      LOAD_TEST_BASE_URL: 'http://127.0.0.1:3011', LOAD_TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1/test',
      LOAD_TEST_APP_ID: 'load-app', LOAD_TEST_CREDENTIAL_ID: 'load-credential', LOAD_TEST_PRIVATE_JWK: '{"d":"private"}',
    })).toMatchObject({ baseUrl: 'http://127.0.0.1:3011', concurrency: 20, maxRetries: 30, deadlineMs: 480_000 })
  })

  it('accounts for a throttled retry once without inflating accepted or duplicate results', async () => {
    const attempts = new Map<string, number>()
    let active = 0
    let peak = 0
    const plan = buildLoadPlan('throttle').slice(0, 2)
    plan.push({ ...plan[0]!, replay: true })
    const result = await runSubmissions(plan, {
      baseUrl: 'http://127.0.0.1:3011', accessToken: 'token', concurrency: 2,
      deadlineMs: 10_000, maxRetries: 2,
      wait: async () => undefined,
      fetchImpl: async (_url, init) => {
        active += 1
        peak = Math.max(peak, active)
        const key = new Headers(init?.headers).get('idempotency-key')!
        const count = (attempts.get(key) ?? 0) + 1
        attempts.set(key, count)
        await Promise.resolve()
        active -= 1
        if (key.endsWith('0000') && count === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
        const duplicate = key.endsWith('0000') && count > 2
        return Response.json({ ticketId: `ticket-${key}`, result: duplicate ? 'duplicate' : 'created', acceptedAt: '2026-08-13T00:00:00.000Z' }, { status: duplicate ? 200 : 201 })
      },
    })
    const summary = summarizeLoad({ observations: result.observations, receiptKeys: new Set(plan.slice(0, 2).map((item) => item.idempotencyKey)), targetKeys: new Set(plan.slice(0, 2).map((item) => item.idempotencyKey)), firstAttemptMs: [1, 2] })
    expect(result.throttledRetries).toBe(1)
    expect(peak).toBeLessThanOrEqual(2)
    expect(summary).toMatchObject({ submitted: 3, acceptedUnique: 2, duplicateReplays: 1, failed: 0, missingReceipts: 0 })
  })

  it('records an exhausted throttle as one failure rather than an acceptance', async () => {
    const result = await runSubmissions(buildLoadPlan('throttle-exhausted').slice(0, 1), {
      baseUrl: 'http://127.0.0.1:3011', accessToken: 'token', concurrency: 1,
      deadlineMs: 10_000, maxRetries: 1, wait: async () => undefined,
      fetchImpl: async () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
    })
    expect(result).toMatchObject({ throttledRetries: 1 })
    expect(result.observations).toEqual([{ idempotencyKey: 'load-throttle-exhausted-0000', replay: false, result: 'failed', status: 429, intakeMs: expect.any(Number) }])
  })

  it('backs off for one second when a throttled response omits Retry-After', async () => {
    const waits: number[] = []
    let attempts = 0
    const result = await runSubmissions(buildLoadPlan('throttle-default').slice(0, 1), {
      baseUrl: 'http://127.0.0.1:3011', accessToken: 'token', concurrency: 1,
      deadlineMs: 10_000, maxRetries: 1, wait: async (milliseconds) => { waits.push(milliseconds) },
      fetchImpl: async () => ++attempts === 1
        ? new Response('{}', { status: 429 })
        : Response.json({ ticketId: 'ticket', result: 'created', acceptedAt: '2026-08-13T00:00:00.000Z' }, { status: 201 }),
    })
    expect(waits).toEqual([1_000])
    expect(result.observations[0]).toMatchObject({ result: 'created' })
  })

  it('aborts a hung request at the bounded global deadline', async () => {
    const startedAt = Date.now()
    const result = await runSubmissions(buildLoadPlan('hung').slice(0, 1), {
      baseUrl: 'http://127.0.0.1:3011', accessToken: 'token', concurrency: 1,
      deadlineMs: 25, maxRetries: 0,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }),
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(result.observations).toEqual([{ idempotencyKey: 'load-hung-0000', replay: false, result: 'failed', status: 0, intakeMs: expect.any(Number) }])
  })

  it('keeps the deadline active while consuming the response body', async () => {
    const startedAt = Date.now()
    const result = await runSubmissions(buildLoadPlan('hung-body').slice(0, 1), {
      baseUrl: 'http://127.0.0.1:3011', accessToken: 'token', concurrency: 1,
      deadlineMs: 25, maxRetries: 0,
      fetchImpl: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          const fallback = setTimeout(() => controller.error(new Error('test fallback')), 150)
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(fallback)
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } }),
    })
    expect(Date.now() - startedAt).toBeLessThan(100)
    expect(result.observations).toEqual([{ idempotencyKey: 'load-hung-body-0000', replay: false, result: 'failed', status: 0, intakeMs: expect.any(Number) }])
  })

  it('does not clean any data when dedicated fixture validation fails', async () => {
    let cleanups = 0
    await expect(withValidatedFixture(
      async () => { throw new Error('not dedicated') },
      async () => undefined,
      async () => { cleanups += 1 },
    )).rejects.toThrow('not dedicated')
    expect(cleanups).toBe(0)
  })

  it('cleans a validated fixture after both successful and failed work', async () => {
    let cleanups = 0
    await expect(withValidatedFixture(
      async () => ({ expectedTargetKeys: new Set(['channel:load']) }),
      async () => { throw new Error('submission failed') },
      async () => { cleanups += 1 },
    )).rejects.toThrow('submission failed')
    expect(cleanups).toBe(1)
  })

  it('refreshes the short-lived service token during a long bounded run', async () => {
    let now = 1_000_000
    let issued = 0
    const provider = createAccessTokenProvider({
      now: () => now,
      requestToken: async () => ({ accessToken: `token-${++issued}`, expiresInSeconds: 300 }),
    })
    expect(await provider()).toBe('token-1')
    now += 269_000
    expect(await provider()).toBe('token-1')
    now += 2_000
    expect(await provider()).toBe('token-2')
  })
})
