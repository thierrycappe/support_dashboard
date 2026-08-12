import { createHmac } from 'node:crypto'
import { classifiedHttp, retryAfter } from '@/lib/delivery/adapters/email'
import { fetchWithProviderTimeout, sanitizedTransportError } from '@/lib/delivery/adapters/transport'
import type { DeliveryAdapterResult } from '@/lib/delivery/dispatch'
import type { DeliveryEvent } from '@/lib/delivery/types'
import { validateWebhookTarget } from '@/lib/delivery/webhook-target'

export async function sendWebhookDelivery(input: {
  event: DeliveryEvent
  config: { type: 'WEBHOOK'; url: string; signingSecret: string }
  idempotencyKey: string
  timestamp?: number
  rawBody?: string
  fetchImpl?: typeof fetch
  validateTarget?: typeof validateWebhookTarget
  timeoutMs?: number
}): Promise<DeliveryAdapterResult> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000)
  const rawBody = input.rawBody ?? JSON.stringify(input.event)
  let target: Awaited<ReturnType<typeof validateWebhookTarget>>
  try {
    target = await (input.validateTarget ?? validateWebhookTarget)(input.config.url)
  } catch (error) {
    return webhookValidationFailure(error)
  }
  const signature = createHmac('sha256', input.config.signingSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex')
  try {
    const { response } = await fetchWithProviderTimeout(input.fetchImpl ?? fetch, target.url, {
      method: 'POST',
      body: rawBody,
      redirect: 'error',
      dispatcher: target.dispatcher,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
        'x-support-timestamp': String(timestamp),
        'x-support-signature': `v1=${signature}`,
      },
    } as RequestInit, async () => '', input.timeoutMs)
    if (!response.ok) return classifiedHttp(response.status, retryAfter(response))
    return {
      result: 'sent',
      providerStatus: response.status,
      providerMessageId: response.headers.get('x-request-id'),
      retryAfterMs: null,
      sanitizedError: null,
    }
  } catch (error) {
    return { result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: sanitizedTransportError(error) }
  } finally {
    // Closing the pinned-DNS dispatcher is cleanup, never a reason to abort a
    // durable sweep after a provider result has already been classified.
    await target.dispatcher.close().catch(() => {})
  }
}

function webhookValidationFailure(error: unknown): DeliveryAdapterResult {
  if (error instanceof Error && error.message === 'Unsafe webhook target') {
    return { result: 'permanent', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: 'UNSAFE_WEBHOOK_TARGET' }
  }
  return { result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: 'DNS_LOOKUP_FAILED' }
}
