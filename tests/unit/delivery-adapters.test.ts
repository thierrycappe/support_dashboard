import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sendEmailDelivery } from '@/lib/delivery/adapters/email'
import { sendPushoverDelivery } from '@/lib/delivery/adapters/pushover'
import { sendWebhookDelivery } from '@/lib/delivery/adapters/webhook'
import type { DeliveryEvent } from '@/lib/delivery/types'

const event: DeliveryEvent = {
  ticketId: 'ticket-1', appName: 'Atelier Planning', kind: 'BUG', priority: 'HIGH',
  title: 'Cannot publish', portalUrl: 'https://support.example.test/feedback/ticket-1',
}

describe('delivery adapters', () => {
  it('signs webhook timestamp and exact body bytes', async () => {
    const rawBody = '{"title":"Cannot publish"}'
    let capturedInit: RequestInit | undefined
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      capturedInit = args[1]
      return new Response('', { status: 202 })
    }) as typeof fetch

    await sendWebhookDelivery({
      event, config: { type: 'WEBHOOK', url: 'https://public.example.test/hook', signingSecret: 'test-secret' },
      idempotencyKey: 'event-1', timestamp: 1_786_538_400, rawBody, fetchImpl,
      validateTarget: async () => ({ url: new URL('https://public.example.test/hook'), addresses: ['93.184.216.34'], dispatcher: { close: async () => {} } } as never),
    })

    const init = capturedInit as RequestInit
    expect((init.headers as Record<string, string>)['x-support-timestamp']).toBe('1786538400')
    expect((init.headers as Record<string, string>)['x-support-signature']).toBe(
      `v1=${createHmac('sha256', 'test-secret').update('1786538400.').update(rawBody).digest('hex')}`,
    )
    expect(init.body).toBe(rawBody)
    expect(init.redirect).toBe('error')
  })

  it('classifies retryable responses and bounds Retry-After', async () => {
    const result = await sendWebhookDelivery({
      event, config: { type: 'WEBHOOK', url: 'https://public.example.test/hook', signingSecret: 'test-secret' },
      idempotencyKey: 'event-1',
      fetchImpl: (async () => new Response('', { status: 429, headers: { 'retry-after': '7200' } })) as typeof fetch,
      validateTarget: async () => ({ url: new URL('https://public.example.test/hook'), addresses: ['93.184.216.34'], dispatcher: { close: async () => {} } } as never),
    })

    expect(result).toMatchObject({ result: 'retryable', providerStatus: 429, retryAfterMs: 60 * 60_000 })
  })

  it('disables redirects, including a redirect toward a private target', async () => {
    let capturedInit: RequestInit | undefined
    const result = await sendWebhookDelivery({
      event, config: { type: 'WEBHOOK', url: 'https://public.example.test/hook', signingSecret: 'test-secret' },
      idempotencyKey: 'event-1',
      fetchImpl: (async (...args: Parameters<typeof fetch>) => {
        capturedInit = args[1]
        return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } })
      }) as typeof fetch,
      validateTarget: async () => ({ url: new URL('https://public.example.test/hook'), addresses: ['93.184.216.34'], dispatcher: { close: async () => {} } } as never),
    })

    expect(capturedInit?.redirect).toBe('error')
    expect(result).toMatchObject({ result: 'permanent', providerStatus: 302, sanitizedError: 'HTTP_302' })
  })

  it('does not send reporter context through the default Pushover event', async () => {
    let capturedInit: RequestInit | undefined
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      capturedInit = args[1]
      return new Response('{"status":1,"request":"message-id"}', { status: 200 })
    }) as typeof fetch
    await sendPushoverDelivery({
      event: { ...event, reporterContext: { name: 'Elodie', email: 'reporter@example.test' } },
      config: { type: 'PUSHOVER', appToken: 'app-token', userKey: 'user-key' },
      idempotencyKey: 'event-1', fetchImpl,
    })
    const form = new URLSearchParams(String((capturedInit as RequestInit).body))
    expect(form.get('message')).not.toContain('reporter@example.test')
    expect(form.get('message')).not.toContain('Elodie')
  })

  it.each([
    ['email', (fetchImpl: typeof fetch) => sendEmailDelivery({ event, config: { type: 'EMAIL', to: ['ops@example.test'] }, idempotencyKey: 'event-1', env: { RESEND_API_KEY: 'key', RESEND_FROM: 'support@example.test' }, fetchImpl, timeoutMs: 10 })],
    ['pushover', (fetchImpl: typeof fetch) => sendPushoverDelivery({ event, config: { type: 'PUSHOVER', appToken: 'token', userKey: 'user' }, idempotencyKey: 'event-1', fetchImpl, timeoutMs: 10 })],
    ['webhook', (fetchImpl: typeof fetch) => sendWebhookDelivery({ event, config: { type: 'WEBHOOK', url: 'https://public.example.test/hook', signingSecret: 'secret' }, idempotencyKey: 'event-1', fetchImpl, timeoutMs: 10, validateTarget: async () => ({ url: new URL('https://public.example.test/hook'), addresses: ['93.184.216.34'], dispatcher: { close: async () => {} } } as never) })],
  ])('returns a sanitized retryable timeout for a hung %s provider', async (_, send) => {
    const result = await send(((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch)

    expect(result).toMatchObject({ result: 'retryable', providerStatus: null, sanitizedError: 'PROVIDER_TIMEOUT' })
  })

  it('times out when Pushover sends headers but its response body never completes', async () => {
    const result = await sendPushoverDelivery({
      event,
      config: { type: 'PUSHOVER', appToken: 'token', userKey: 'user' },
      idempotencyKey: 'event-1',
      timeoutMs: 10,
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => new Promise<string>(() => {}),
      })) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({ result: 'retryable', providerStatus: null, sanitizedError: 'PROVIDER_TIMEOUT' })
  })

  it('makes unsafe webhook targets permanent and transient DNS failures retryable', async () => {
    const base = {
      event, config: { type: 'WEBHOOK' as const, url: 'https://public.example.test/hook', signingSecret: 'test-secret' }, idempotencyKey: 'event-1',
    }
    await expect(sendWebhookDelivery({
      ...base,
      validateTarget: async () => { throw new Error('Unsafe webhook target') },
    })).resolves.toMatchObject({ result: 'permanent', sanitizedError: 'UNSAFE_WEBHOOK_TARGET' })
    await expect(sendWebhookDelivery({
      ...base,
      validateTarget: async () => { throw new Error('ENOTFOUND') },
    })).resolves.toMatchObject({ result: 'retryable', sanitizedError: 'DNS_LOOKUP_FAILED' })
  })

  it('does not let webhook dispatcher cleanup abort a delivery sweep', async () => {
    await expect(sendWebhookDelivery({
      event,
      config: { type: 'WEBHOOK', url: 'https://public.example.test/hook', signingSecret: 'test-secret' },
      idempotencyKey: 'event-1',
      fetchImpl: (async () => new Response('', { status: 202 })) as typeof fetch,
      validateTarget: async () => ({
        url: new URL('https://public.example.test/hook'),
        addresses: ['93.184.216.34'],
        dispatcher: { close: async () => { throw new Error('close failed') } },
      } as never),
    })).resolves.toMatchObject({ result: 'sent', providerStatus: 202 })
  })

  it('sends Resend-compatible email with a durable idempotency key', async () => {
    let capturedInit: RequestInit | undefined
    const result = await sendEmailDelivery({
      event,
      config: { type: 'EMAIL', to: ['ops@example.test'] },
      idempotencyKey: 'event-1',
      env: { RESEND_API_KEY: 'api-key', RESEND_FROM: 'support@example.test' },
      fetchImpl: (async (...args: Parameters<typeof fetch>) => {
        capturedInit = args[1]
        return new Response('{"id":"email-1"}', { status: 200 })
      }) as typeof fetch,
    })

    expect(result).toMatchObject({ result: 'sent', providerStatus: 200, providerMessageId: 'email-1' })
    expect(capturedInit?.headers).toMatchObject({
      authorization: 'Bearer api-key',
      'idempotency-key': 'event-1',
    })
  })
})
