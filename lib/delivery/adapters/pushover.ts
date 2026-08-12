import { classifiedHttp, retryAfter } from '@/lib/delivery/adapters/email'
import { fetchWithProviderTimeout, sanitizedTransportError } from '@/lib/delivery/adapters/transport'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import type { DeliveryEvent } from '@/lib/delivery/types'

const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json'

export async function sendPushoverDelivery(input: {
  event: DeliveryEvent
  config: { type: 'PUSHOVER'; appToken: string; userKey: string }
  idempotencyKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<DeliveryAdapterResult> {
  const body = new URLSearchParams({
    token: input.config.appToken,
    user: input.config.userKey,
    title: input.event.title,
    message: pushoverMessage(input.event),
    url: input.event.portalUrl,
  })
  try {
    const response = await fetchWithProviderTimeout(input.fetchImpl ?? fetch, PUSHOVER_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': input.idempotencyKey,
      },
      body,
    }, input.timeoutMs)
    const text = await response.text()
    if (!response.ok) return classifiedHttp(response.status, retryAfter(response))
    return {
      result: 'sent',
      providerStatus: response.status,
      providerMessageId: pushoverRequestId(text),
      retryAfterMs: null,
      sanitizedError: null,
    }
  } catch (error) {
    return { result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: sanitizedTransportError(error) }
  }
}

function pushoverMessage(event: DeliveryEvent): string {
  // Pushover is the compatibility bridge, not an approved reporter-data
  // destination. Keep its rendered provider message minimized even if an
  // upstream payload accidentally contains target-scoped context.
  return `${event.appName}\n${event.kind} · ${event.priority}\n${event.portalUrl}`
}

function pushoverRequestId(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { request?: unknown }
    return typeof parsed.request === 'string' ? parsed.request : null
  } catch {
    return null
  }
}
