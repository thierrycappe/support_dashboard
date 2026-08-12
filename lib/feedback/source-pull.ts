import { z } from 'zod'
import {
  feedbackIngestSchema,
  type FeedbackIngestPayload,
  type IngestResult,
} from '@/lib/feedback/ingest'
import { validateWebhookTarget } from '@/lib/delivery/webhook-target'

const pullConfigEntrySchema = z.object({
  url: z.string().url().superRefine((value, context) => {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
      context.addIssue({ code: 'custom', message: 'Unsafe source pull configuration' })
    }
  }),
  token: z.string().min(1),
}).strict()
const DEFAULT_PULL_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_PULL_TICKETS = 500

export interface SourceAppPullConfig {
  url: string
  token: string
}

type Env = Record<string, string | undefined>

export function getSourceAppPullConfig(
  appSlug: string,
  env: Env = process.env,
): SourceAppPullConfig | null {
  const json = env.SUPPORT_TOWER_SOURCE_APP_PULL_JSON?.trim()
  if (!json) return null
  const parsed = parsePullMap(json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Source pull configuration is invalid')
  }
  const entry = (parsed as Record<string, unknown>)[appSlug]
  if (!entry) return null
  const result = pullConfigEntrySchema.safeParse(entry)
  if (!result.success) throw new Error('Source pull configuration is invalid')
  return result.data
}

export function listConfiguredPullSlugs(env: Env = process.env): string[] {
  const json = env.SUPPORT_TOWER_SOURCE_APP_PULL_JSON?.trim()
  if (!json) return []
  let parsed: unknown
  try { parsed = parsePullMap(json) } catch { return [] }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  return Object.keys(parsed as Record<string, unknown>)
}

const pullResponseSchema = z.object({
  tickets: z.array(feedbackIngestSchema).max(MAX_PULL_TICKETS),
}).strict()

export interface FetchTicketsParams {
  config: SourceAppPullConfig
  externalId?: string | null
  fetchImpl?: typeof fetch
  validateTarget?: typeof validateWebhookTarget
  timeoutMs?: number
  maxResponseBytes?: number
}

export async function fetchTicketsFromSource({
  config,
  externalId,
  fetchImpl = fetch,
  validateTarget = validateWebhookTarget,
  timeoutMs = DEFAULT_PULL_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
}: FetchTicketsParams): Promise<FeedbackIngestPayload[]> {
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 1
    || !Number.isFinite(maxResponseBytes) || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('Source pull limits are invalid')
  }
  const url = new URL(config.url)
  if (externalId) url.searchParams.set('externalId', externalId)

  let target: Awaited<ReturnType<typeof validateWebhookTarget>>
  try {
    target = await validateTarget(url.toString())
  } catch {
    throw new Error('Source pull target is unavailable')
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.max(1, timeoutMs))
  let mustDestroy = false
  try {
    const response = await fetchImpl(target.url.toString(), {
      headers: { Authorization: `Bearer ${config.token}` },
      redirect: 'error',
      dispatcher: target.dispatcher,
      signal: abort.signal,
    } as RequestInit)
    if (!response.ok) {
      mustDestroy = true
      await response.body?.cancel().catch(() => {})
      throw new Error(`Source pull failed: HTTP_${response.status}`)
    }

    try {
      const raw = await readBoundedResponse(response, maxResponseBytes, abort.signal)
      const parsed = pullResponseSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        if (parsed.error.issues.some((issue) => issue.code === 'too_big' && issue.path[0] === 'tickets')) {
          throw new Error('Source pull failed: TOO_MANY_TICKETS')
        }
        throw new Error('Source pull failed: INVALID_RESPONSE')
      }
      return parsed.data.tickets
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Source pull failed:')) {
        if (error.message === 'Source pull failed: RESPONSE_TOO_LARGE') mustDestroy = true
        throw error
      }
      throw new Error('Source pull failed: INVALID_RESPONSE')
    }
  } catch (error) {
    if (abort.signal.aborted) {
      mustDestroy = true
      throw new Error('Source pull failed: TIMEOUT')
    }
    if (error instanceof Error && error.message.startsWith('Source pull failed:')) throw error
    throw new Error('Source pull failed: REQUEST_FAILED')
  } finally {
    clearTimeout(timer)
    if (mustDestroy) await target.dispatcher.destroy().catch(() => {})
    else await target.dispatcher.close().catch(async () => { await target.dispatcher.destroy().catch(() => {}) })
  }
}

export interface PullSourceAppResult {
  appSlug: string
  pulled: number
  created: number
  updated: number
  errors: string[]
}

export interface PullSourceAppOptions {
  appSlug: string
  env?: Env
  fetchImpl?: typeof fetch
  validateTarget?: typeof validateWebhookTarget
  accept?: (payload: FeedbackIngestPayload, authoritativeAppSlug: string) => Promise<IngestResult>
  logger?: Pick<Console, 'warn'>
}

export async function pullSourceApp({
  appSlug,
  env = process.env,
  fetchImpl = fetch,
  validateTarget = validateWebhookTarget,
  accept,
  logger = console,
}: PullSourceAppOptions): Promise<PullSourceAppResult> {
  const result: PullSourceAppResult = {
    appSlug,
    pulled: 0,
    created: 0,
    updated: 0,
    errors: [],
  }

  let config: SourceAppPullConfig | null
  try {
    config = getSourceAppPullConfig(appSlug, env)
  } catch {
    result.errors.push('Source pull configuration is invalid')
    logger.warn('Source pull configuration failed', { appSlug })
    return result
  }
  if (!config) {
    result.errors.push('no pull config')
    return result
  }

  let tickets: FeedbackIngestPayload[]
  try {
    tickets = await fetchTicketsFromSource({ config, fetchImpl, validateTarget })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(message)
    logger.warn('Source pull fetch failed', { appSlug, error: message })
    return result
  }

  for (const payload of tickets) {
    try {
      if (payload.app.slug !== appSlug) throw new SourceIdentityMismatchError()
      if (!accept) {
        const { acceptLegacyPayload, legacyResult } = await import('@/lib/escalations/legacy')
        const accepted = await acceptLegacyPayload({ payload, authoritativeAppSlug: appSlug })
        result.pulled += 1
        if (legacyResult(accepted).created) result.created += 1
        else result.updated += 1
        continue
      }
      const ingestResult = await accept(payload, appSlug)
      result.pulled += 1
      if (ingestResult.created) result.created += 1
      else result.updated += 1
    } catch (error) {
      const message = error instanceof SourceIdentityMismatchError ? 'SOURCE_IDENTITY_MISMATCH' : 'INGEST_FAILED'
      result.errors.push(`${payload.ticket.externalId}: ${message}`)
      logger.warn('Source pull ingest failed', {
        appSlug,
        externalId: payload.ticket.externalId,
        error: message,
      })
    }
  }

  return result
}

class SourceIdentityMismatchError extends Error {}

function parsePullMap(json: string): unknown {
  try { return JSON.parse(json) as unknown } catch { throw new Error('Source pull configuration is invalid') }
}

async function readBoundedResponse(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('Source pull failed: INVALID_RESPONSE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      if (signal.aborted) throw new Error('Source pull failed: TIMEOUT')
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('Source pull failed: RESPONSE_TOO_LARGE')
      }
      chunks.push(chunk.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  const result = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(result)
}
