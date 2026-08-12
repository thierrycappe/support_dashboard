import { createHmac } from 'node:crypto'
import { classifiedHttp, errorName, retryAfter } from '@/lib/delivery/adapters/email'
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
}): Promise<DeliveryAdapterResult> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000)
  const rawBody = input.rawBody ?? JSON.stringify(input.event)
  const target = await (input.validateTarget ?? validateWebhookTarget)(input.config.url)
  const signature = createHmac('sha256', input.config.signingSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex')
  try {
    const response = await (input.fetchImpl ?? fetch)(target.url, {
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
    } as RequestInit)
    if (!response.ok) return classifiedHttp(response.status, retryAfter(response))
    return {
      result: 'sent',
      providerStatus: response.status,
      providerMessageId: response.headers.get('x-request-id'),
      retryAfterMs: null,
      sanitizedError: null,
    }
  } catch (error) {
    return { result: 'retryable', providerStatus: null, providerMessageId: null, retryAfterMs: null, sanitizedError: errorName(error) }
  } finally {
    await target.dispatcher.close()
  }
}
