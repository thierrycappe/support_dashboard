import { describe, expect, it, vi } from 'vitest'
import { validateWebhookTarget } from '@/lib/delivery/webhook-target'
import {
  fetchTicketsFromSource,
  getSourceAppPullConfig,
  listConfiguredPullSlugs,
  pullSourceApp,
} from '@/lib/feedback/source-pull'

const sampleTicket = {
  app: {
    slug: 'casal-track',
    name: 'Casal Track',
    baseUrl: 'https://casal-track.example.com',
    environment: 'production',
  },
  ticket: {
    externalId: 'ct_42',
    kind: 'BUG',
    status: 'CLOSED',
    priority: 'MEDIUM',
    title: 'Issue resolved upstream',
    description: 'Closed in source app.',
  },
}

const envWithCasal = {
  SUPPORT_TOWER_SOURCE_APP_PULL_JSON: JSON.stringify({
    'casal-track': {
      url: 'https://casal-track.example.com/api/support-tower/export',
      token: 'pull-secret',
    },
  }),
}

describe('source pull configuration', () => {
  it('returns the entry for a configured app slug', () => {
    const config = getSourceAppPullConfig('casal-track', envWithCasal)
    expect(config).toEqual({
      url: 'https://casal-track.example.com/api/support-tower/export',
      token: 'pull-secret',
    })
  })

  it('returns null when the slug is not configured', () => {
    expect(getSourceAppPullConfig('pitchme', envWithCasal)).toBeNull()
  })

  it('returns null when no JSON map is configured', () => {
    expect(getSourceAppPullConfig('casal-track', {})).toBeNull()
  })

  it('throws when the JSON map is not an object', () => {
    expect(() =>
      getSourceAppPullConfig('casal-track', {
        SUPPORT_TOWER_SOURCE_APP_PULL_JSON: '["bad"]',
      }),
    ).toThrow('Source pull configuration is invalid')
  })

  it('classifies malformed JSON without returning the input or token and lets cron discovery fail closed', () => {
    const malformed = '{"casal-track":{"token":"do-not-expose"}'

    expect(() => getSourceAppPullConfig('casal-track', {
      SUPPORT_TOWER_SOURCE_APP_PULL_JSON: malformed,
    })).toThrow('Source pull configuration is invalid')
    expect(() => getSourceAppPullConfig('casal-track', {
      SUPPORT_TOWER_SOURCE_APP_PULL_JSON: malformed,
    })).not.toThrow(/do-not-expose|Unexpected|JSON/)
    expect(listConfiguredPullSlugs({ SUPPORT_TOWER_SOURCE_APP_PULL_JSON: malformed })).toEqual([])
  })

  it('lists all configured slugs', () => {
    expect(listConfiguredPullSlugs(envWithCasal)).toEqual(['casal-track'])
  })

  it.each([
    'http://public.example.test/export',
    'https://user:password@public.example.test/export',
    'https://public.example.test:8443/export',
  ])('rejects unsafe configured URL syntax before a bearer can be used: %s', (url) => {
    expect(() => getSourceAppPullConfig('casal-track', {
      SUPPORT_TOWER_SOURCE_APP_PULL_JSON: JSON.stringify({
        'casal-track': { url, token: 'pull-secret' },
      }),
    })).toThrow('Source pull configuration is invalid')
  })
})

describe('fetchTicketsFromSource', () => {
  it('sends a bearer only to the currently validated, DNS-pinned public target and parses the complete response', async () => {
    const validateTarget = vi.fn((value: string) => validateWebhookTarget(value, {
      lookup: async () => ['93.184.216.34'],
    }))
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).not.toContain('since=')
      expect(String(url)).toBe('https://casal-track.example.com/api/support-tower/export')
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer pull-secret',
      )
      expect(init?.redirect).toBe('error')
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined()
      return new Response(JSON.stringify({ tickets: [sampleTicket] }), {
        status: 200,
      })
    })

    const tickets = await fetchTicketsFromSource({
      config: {
        url: 'https://casal-track.example.com/api/support-tower/export',
        token: 'pull-secret',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget,
    })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].ticket.externalId).toBe('ct_42')
    expect(validateTarget).toHaveBeenCalledOnce()
  })

  it.each([
    'https://127.0.0.1/export',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/export',
    'https://[::1]/export',
    'https://[fc00::1]/export',
  ])('does not send a bearer to direct private or special-use target %s', async (url) => {
    const fetchImpl = vi.fn()

    await expect(fetchTicketsFromSource({
      config: { url, token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('Source pull target is unavailable')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not send a bearer when the current DNS answer is private', async () => {
    const fetchImpl = vi.fn()
    const validateTarget = vi.fn((value: string) => validateWebhookTarget(value, {
      lookup: async () => ['10.0.0.8'],
    }))

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget,
    })).rejects.toThrow('Source pull target is unavailable')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('classifies resolver failures without exposing resolver details', async () => {
    const fetchImpl = vi.fn()
    const validateTarget = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND secret.internal') })

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget,
    })).rejects.toThrow('Source pull target is unavailable')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('revalidates and pins the current DNS answer on every pull', async () => {
    const targets = [
      await validateWebhookTarget('https://pull.example.test/export', { lookup: async () => ['93.184.216.34'] }),
      await validateWebhookTarget('https://pull.example.test/export', { lookup: async () => ['93.184.216.35'] }),
    ]
    const validateTarget = vi.fn()
      .mockResolvedValueOnce(targets[0])
      .mockResolvedValueOnce(targets[1])
    const dispatchers: unknown[] = []
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      dispatchers.push((init as RequestInit & { dispatcher?: unknown }).dispatcher)
      return new Response(JSON.stringify({ tickets: [] }), { status: 200 })
    })
    const input = {
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget,
    }

    await fetchTicketsFromSource(input)
    await fetchTicketsFromSource(input)

    expect(validateTarget).toHaveBeenCalledTimes(2)
    expect(dispatchers).toEqual([targets[0].dispatcher, targets[1].dispatcher])
  })

  it('forbids redirects so a bearer is never forwarded to another target', async () => {
    const target = await validateWebhookTarget('https://pull.example.test/export', {
      lookup: async () => ['93.184.216.34'],
    })
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.redirect !== 'error') throw new Error('bearer forwarded to redirect target')
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } })
    })

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: async () => target,
    })).rejects.toThrow('Source pull failed: HTTP_302')

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('aborts a stalled request at the bounded deadline and destroys the pinned dispatcher', async () => {
    let aborted = false
    let destroyed = false
    const dispatcher = {
      close: async () => { throw new Error('close must not wait after timeout') },
      destroy: async () => { destroyed = true },
    }
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('secret upstream detail', 'AbortError'))
      })
    }))

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: async () => ({ url: new URL('https://pull.example.test/export'), addresses: ['93.184.216.34'], dispatcher } as never),
      timeoutMs: 10,
    })).rejects.toThrow('Source pull failed: TIMEOUT')

    expect(aborted).toBe(true)
    expect(destroyed).toBe(true)
  })

  it('cancels and destroys an oversized streamed response without parsing it', async () => {
    let cancelled = false
    let destroyed = false
    const dispatcher = { close: async () => undefined, destroy: async () => { destroyed = true } }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"tickets":['))
        controller.enqueue(new Uint8Array(65))
      },
      cancel() { cancelled = true },
    })

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: async () => new Response(body, { status: 200 }),
      validateTarget: async () => ({ url: new URL('https://pull.example.test/export'), addresses: ['93.184.216.34'], dispatcher } as never),
      maxResponseBytes: 64,
    })).rejects.toThrow('Source pull failed: RESPONSE_TOO_LARGE')

    expect(cancelled).toBe(true)
    expect(destroyed).toBe(true)
  })

  it('rejects a response beyond the bounded ticket count', async () => {
    const tickets = Array.from({ length: 501 }, (_, index) => ({
      ...sampleTicket,
      ticket: { ...sampleTicket.ticket, externalId: `ct_${index}` },
    }))

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: async () => Response.json({ tickets }),
      validateTarget: publicTarget,
    })).rejects.toThrow('Source pull failed: TOO_MANY_TICKETS')
  })

  it('throws when the upstream responds with an error status', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('boom', { status: 502, statusText: 'Bad Gateway' }),
    )

    await expect(
      fetchTicketsFromSource({
        config: { url: 'https://casal-track.example.com/api', token: 't' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        validateTarget: publicTarget,
      }),
    ).rejects.toThrow('Source pull failed: HTTP_502')
  })

  it('cancels an unfinished non-2xx body and destroys the dispatcher without waiting for graceful close', async () => {
    let cancelled = false
    let destroyed = false
    let closeCalled = false
    const dispatcher = {
      close: async () => { closeCalled = true; await new Promise(() => {}) },
      destroy: async () => { destroyed = true },
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('partial upstream secret')) },
      cancel() { cancelled = true },
    })
    const pull = fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: async () => new Response(body, { status: 503 }),
      validateTarget: async () => ({ url: new URL('https://pull.example.test/export'), addresses: ['93.184.216.34'], dispatcher } as never),
    })

    await expect(Promise.race([
      pull,
      new Promise((_, reject) => setTimeout(() => reject(new Error('non-2xx cleanup stalled')), 100)),
    ])).rejects.toThrow('Source pull failed: HTTP_503')
    expect(cancelled).toBe(true)
    expect(destroyed).toBe(true)
    expect(closeCalled).toBe(false)
  })

  it.each([
    { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: Number.NaN },
    { maxResponseBytes: 0 }, { maxResponseBytes: -1 }, { maxResponseBytes: Number.NaN },
  ])('rejects invalid injected pull limits before resolving or sending: %j', async (limits) => {
    const fetchImpl = vi.fn()
    const validateTarget = vi.fn()

    await expect(fetchTicketsFromSource({
      config: { url: 'https://pull.example.test/export', token: 'pull-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget,
      ...limits,
    })).rejects.toThrow('Source pull limits are invalid')
    expect(validateTarget).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('includes externalId as a query param when provided', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('externalId=ct_42')
      return new Response(JSON.stringify({ tickets: [] }), { status: 200 })
    })

    await fetchTicketsFromSource({
      config: { url: 'https://casal-track.example.com/api', token: 't' },
      externalId: 'ct_42',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: publicTarget,
    })
  })
})

describe('pullSourceApp', () => {
  it('reports unsafe configuration without exposing its bearer', async () => {
    const warn = vi.fn()

    const result = await pullSourceApp({
      appSlug: 'casal-track',
      env: {
        SUPPORT_TOWER_SOURCE_APP_PULL_JSON: JSON.stringify({
          'casal-track': { url: 'http://127.0.0.1/export', token: 'do-not-log-this-token' },
        }),
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      accept: vi.fn(),
      logger: { warn },
    })

    expect(result.errors).toEqual(['Source pull configuration is invalid'])
    expect(warn).toHaveBeenCalledWith('Source pull configuration failed', { appSlug: 'casal-track' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-log-this-token')
  })

  it('ingests each ticket and counts created vs updated', async () => {
    const accept = vi
      .fn()
      .mockResolvedValueOnce({ appId: 'a', ticketId: 't1', created: true })
      .mockResolvedValueOnce({ appId: 'a', ticketId: 't2', created: false })

    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tickets: [
            sampleTicket,
            { ...sampleTicket, ticket: { ...sampleTicket.ticket, externalId: 'ct_43' } },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await pullSourceApp({
      appSlug: 'casal-track',
      env: envWithCasal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: publicTarget,
      accept,
    })

    expect(result.pulled).toBe(2)
    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.errors).toEqual([])
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenLastCalledWith(expect.any(Object), 'casal-track')
  })

  it('reports an error when no pull config exists for the slug', async () => {
    const result = await pullSourceApp({
      appSlug: 'pitchme',
      env: envWithCasal,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      accept: vi.fn(),
    })

    expect(result.pulled).toBe(0)
    expect(result.errors).toEqual(['no pull config'])
  })

  it('captures fetch failures without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })

    const result = await pullSourceApp({
      appSlug: 'casal-track',
      env: envWithCasal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: publicTarget,
      accept: vi.fn(),
      logger: { warn: vi.fn() },
    })

    expect(result.pulled).toBe(0)
    expect(result.errors).toEqual(['Source pull failed: REQUEST_FAILED'])
  })

  it('captures per-ticket ingest failures and keeps processing siblings', async () => {
    const accept = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ appId: 'a', ticketId: 't2', created: true })

    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tickets: [
            sampleTicket,
            { ...sampleTicket, ticket: { ...sampleTicket.ticket, externalId: 'ct_43' } },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await pullSourceApp({
      appSlug: 'casal-track',
      env: envWithCasal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: publicTarget,
      accept,
      logger: { warn: vi.fn() },
    })

    expect(result.pulled).toBe(1)
    expect(result.created).toBe(1)
    expect(result.errors).toEqual(['ct_42: INGEST_FAILED'])
  })

  it('never returns or logs raw per-ticket intake errors', async () => {
    const warn = vi.fn()
    const accept = vi.fn().mockRejectedValue(new Error('database password do-not-expose'))
    const fetchImpl = vi.fn(async () => Response.json({ tickets: [sampleTicket] }))

    const result = await pullSourceApp({
      appSlug: 'casal-track', env: envWithCasal,
      fetchImpl: fetchImpl as unknown as typeof fetch, validateTarget: publicTarget,
      accept, logger: { warn },
    })

    expect(result.errors).toEqual(['ct_42: INGEST_FAILED'])
    expect(warn).toHaveBeenCalledWith('Source pull ingest failed', {
      appSlug: 'casal-track', externalId: 'ct_42', error: 'INGEST_FAILED',
    })
    expect(JSON.stringify({ result, calls: warn.mock.calls })).not.toContain('do-not-expose')
  })

  it('rejects a payload whose app slug differs from the configured app', async () => {
    const accept = vi.fn()
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tickets: [{
            ...sampleTicket,
            app: { ...sampleTicket.app, slug: 'other-app' },
          }],
        }),
        { status: 200 },
      ),
    )

    const result = await pullSourceApp({
      appSlug: 'casal-track',
      env: envWithCasal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      validateTarget: publicTarget,
      accept,
      logger: { warn: vi.fn() },
    })

    expect(result.errors).toEqual(['ct_42: SOURCE_IDENTITY_MISMATCH'])
    expect(accept).not.toHaveBeenCalled()
  })
})

function publicTarget(value: string) {
  return validateWebhookTarget(value, { lookup: async () => ['93.184.216.34'] })
}
