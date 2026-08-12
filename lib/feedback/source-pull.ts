import { z } from 'zod'
import {
  feedbackIngestSchema,
  type FeedbackIngestPayload,
  type IngestResult,
} from '@/lib/feedback/ingest'
import { acceptLegacyPayload, legacyResult } from '@/lib/escalations/legacy'

const pullConfigEntrySchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
})

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
  const parsed = JSON.parse(json) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SUPPORT_TOWER_SOURCE_APP_PULL_JSON must be a JSON object')
  }
  const entry = (parsed as Record<string, unknown>)[appSlug]
  if (!entry) return null
  return pullConfigEntrySchema.parse(entry)
}

export function listConfiguredPullSlugs(env: Env = process.env): string[] {
  const json = env.SUPPORT_TOWER_SOURCE_APP_PULL_JSON?.trim()
  if (!json) return []
  const parsed = JSON.parse(json) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  return Object.keys(parsed as Record<string, unknown>)
}

const pullResponseSchema = z.object({
  tickets: z.array(feedbackIngestSchema),
})

export interface FetchTicketsParams {
  config: SourceAppPullConfig
  externalId?: string | null
  fetchImpl?: typeof fetch
}

export async function fetchTicketsFromSource({
  config,
  externalId,
  fetchImpl = fetch,
}: FetchTicketsParams): Promise<FeedbackIngestPayload[]> {
  const url = new URL(config.url)
  if (externalId) url.searchParams.set('externalId', externalId)

  const response = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${config.token}` },
  })

  if (!response.ok) {
    throw new Error(
      `Source app pull failed: ${response.status} ${response.statusText}`,
    )
  }

  const json = await response.json()
  const parsed = pullResponseSchema.parse(json)
  return parsed.tickets
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
  accept?: (payload: FeedbackIngestPayload, authoritativeAppSlug: string) => Promise<IngestResult>
  logger?: Pick<Console, 'warn'>
}

export async function pullSourceApp({
  appSlug,
  env = process.env,
  fetchImpl = fetch,
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

  const config = getSourceAppPullConfig(appSlug, env)
  if (!config) {
    result.errors.push('no pull config')
    return result
  }

  let tickets: FeedbackIngestPayload[]
  try {
    tickets = await fetchTicketsFromSource({ config, fetchImpl })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(message)
    logger.warn('Source pull fetch failed', { appSlug, error: message })
    return result
  }

  for (const payload of tickets) {
    try {
      if (payload.app.slug !== appSlug) throw new Error('source app identity mismatch')
      if (!accept) {
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
      const message = error instanceof Error ? error.message : String(error)
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
