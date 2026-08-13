import { sendEmailDelivery } from '@/lib/delivery/adapters/email'
import { sendPushoverDelivery } from '@/lib/delivery/adapters/pushover'
import { sendWebhookDelivery } from '@/lib/delivery/adapters/webhook'
import type { ChannelConfig, DeliveryEvent } from '@/lib/delivery/types'

export interface DeliveryAdapterResult {
  result: 'sent' | 'retryable' | 'permanent'
  providerStatus: number | null
  providerMessageId: string | null
  retryAfterMs: number | null
  sanitizedError: string | null
}

export interface DeliveryAdapter {
  send(input: {
    event: DeliveryEvent
    config: ChannelConfig
    idempotencyKey: string
    fetchImpl?: typeof fetch
  }): Promise<DeliveryAdapterResult>
}

export async function dispatchDelivery(input: {
  event: DeliveryEvent
  config: ChannelConfig
  idempotencyKey: string
  fetchImpl?: typeof fetch
}): Promise<DeliveryAdapterResult> {
  const { event, config, idempotencyKey, fetchImpl } = input
  if (config.type === 'EMAIL') return sendEmailDelivery({ event, config, idempotencyKey, fetchImpl })
  if (config.type === 'PUSHOVER') return sendPushoverDelivery({ event, config, idempotencyKey, fetchImpl })
  return sendWebhookDelivery({ event, config, idempotencyKey, fetchImpl })
}
