import type {
  FeedbackIngestPayload,
  IngestResult,
} from '@/lib/feedback/ingest'

const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json'
const MAX_TITLE_LENGTH = 250
const MAX_MESSAGE_LENGTH = 1024

type Env = Record<string, string | undefined>

export interface PushoverConfig {
  appToken: string
  userKey: string
}

export interface PushoverMessage {
  title: string
  message: string
  priority: -1 | 0 | 1
  url?: string
  url_title?: string
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

interface NotifyTicketCreatedOptions {
  payload: FeedbackIngestPayload
  result: IngestResult
  env?: Env
  fetchImpl?: FetchLike
  logger?: Pick<Console, 'warn'>
}

export type NotificationResult = 'disabled' | 'sent' | 'failed'

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

export function getPushoverConfig(env: Env = process.env): PushoverConfig | null {
  const appToken = env.PUSHOVER_APP_TOKEN?.trim()
  const userKey = env.PUSHOVER_USER_KEY?.trim()

  if (!appToken || !userKey) return null
  return { appToken, userKey }
}

export function getTowerPublicUrl(env: Env = process.env): string | null {
  const explicitUrl =
    env.SUPPORT_TOWER_PUBLIC_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim()

  if (explicitUrl) return explicitUrl.replace(/\/+$/, '')

  const vercelUrl = env.VERCEL_URL?.trim()
  if (!vercelUrl) return null

  const normalized = vercelUrl.startsWith('http')
    ? vercelUrl
    : `https://${vercelUrl}`
  return normalized.replace(/\/+$/, '')
}

function pushoverPriority(
  priority: FeedbackIngestPayload['ticket']['priority'],
): PushoverMessage['priority'] {
  if (priority === 'URGENT') return 1
  if (priority === 'LOW') return -1
  return 0
}

export function buildTicketCreatedPushoverMessage(
  payload: FeedbackIngestPayload,
  result: IngestResult,
  env: Env = process.env,
): PushoverMessage {
  const towerUrl = getTowerPublicUrl(env)
  const ticket = payload.ticket
  const appName = payload.app.name
  const reporter = ticket.reporterEmail || ticket.reporterName || 'Unknown reporter'
  const sourceUrl = ticket.url ? `Source: ${ticket.url}` : null
  const towerTicketUrl = towerUrl ? `${towerUrl}/feedback/${result.ticketId}` : null
  const messageParts = [
    compact(`${ticket.kind} - ${ticket.priority} - ${ticket.status}`),
    compact(ticket.title),
    compact(`App: ${appName}`),
    compact(`Reporter: ${reporter}`),
    sourceUrl,
  ].filter(Boolean)

  return {
    title: truncate(`New support ticket: ${ticket.title}`, MAX_TITLE_LENGTH),
    message: truncate(messageParts.join('\n'), MAX_MESSAGE_LENGTH),
    priority: pushoverPriority(ticket.priority),
    url: towerTicketUrl ?? ticket.url ?? undefined,
    url_title: towerTicketUrl
      ? 'Open in Support Tower'
      : ticket.url
        ? 'Open source ticket'
        : undefined,
  }
}

function buildPushoverBody(
  config: PushoverConfig,
  message: PushoverMessage,
): URLSearchParams {
  const body = new URLSearchParams({
    token: config.appToken,
    user: config.userKey,
    title: message.title,
    message: message.message,
    priority: String(message.priority),
  })

  if (message.url) body.set('url', message.url)
  if (message.url_title) body.set('url_title', message.url_title)

  return body
}

export async function notifyTicketCreated({
  payload,
  result,
  env = process.env,
  fetchImpl = fetch,
  logger = console,
}: NotifyTicketCreatedOptions): Promise<NotificationResult> {
  const config = getPushoverConfig(env)
  if (!config) return 'disabled'

  const message = buildTicketCreatedPushoverMessage(payload, result, env)

  try {
    const response = await fetchImpl(PUSHOVER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildPushoverBody(config, message),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('Support tower Pushover notification failed', {
        status: response.status,
        body,
        ticketId: result.ticketId,
        appSlug: payload.app.slug,
      })
      return 'failed'
    }

    return 'sent'
  } catch (error) {
    logger.warn('Support tower Pushover notification failed', {
      error,
      ticketId: result.ticketId,
      appSlug: payload.app.slug,
    })
    return 'failed'
  }
}
