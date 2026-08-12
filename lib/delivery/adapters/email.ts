import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import type { DeliveryEvent } from '@/lib/delivery/types'

type Env = Record<string, string | undefined>

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

export async function sendEmailDelivery(input: {
  event: DeliveryEvent
  config: { type: 'EMAIL'; to: string[] }
  idempotencyKey: string
  env?: Env
  fetchImpl?: typeof fetch
}): Promise<DeliveryAdapterResult> {
  const env = input.env ?? process.env
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.RESEND_FROM?.trim()
  if (!apiKey || !from) return permanent('EMAIL_NOT_CONFIGURED')
  const body = JSON.stringify({
    from,
    to: input.config.to,
    subject: `[${input.event.priority}] ${input.event.title}`,
    text: emailText(input.event),
  })
  try {
    const response = await (input.fetchImpl ?? fetch)(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body,
    })
    const text = await response.text()
    if (!response.ok) return classifiedHttp(response.status, retryAfter(response))
    return {
      result: 'sent',
      providerStatus: response.status,
      providerMessageId: jsonId(text),
      retryAfterMs: null,
      sanitizedError: null,
    }
  } catch (error) {
    return { result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: errorName(error) }
  }
}

function emailText(event: DeliveryEvent): string {
  const reporter = event.reporterContext
    ? `\nReporter: ${event.reporterContext.name ?? 'Unknown'} <${event.reporterContext.email ?? 'unknown'}>`
    : ''
  return `${event.appName}\n${event.kind} · ${event.priority}\n${event.title}\n${event.portalUrl}${reporter}`
}

export function classifiedHttp(status: number, retryAfterMs: number | null): DeliveryAdapterResult {
  return {
    result: status === 429 || status >= 500 ? 'retryable' : 'permanent',
    providerStatus: status,
    providerMessageId: null,
    retryAfterMs,
    sanitizedError: `HTTP_${status}`,
  }
}

export function retryAfter(response: Response): number | null {
  const value = response.headers.get('retry-after')
  if (!value) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1000, 0), 60 * 60_000) : null
}

export function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'NETWORK_ERROR'
}

function permanent(reason: string): DeliveryAdapterResult {
  return { result: 'permanent', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: reason }
}

function jsonId(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : null
  } catch {
    return null
  }
}
