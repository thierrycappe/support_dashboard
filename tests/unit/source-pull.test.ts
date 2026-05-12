import { describe, expect, it, vi } from 'vitest'
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
    ).toThrow(/JSON object/)
  })

  it('lists all configured slugs', () => {
    expect(listConfiguredPullSlugs(envWithCasal)).toEqual(['casal-track'])
  })
})

describe('fetchTicketsFromSource', () => {
  it('sends a bearer token and parses the response', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('since=2026-05-01T00%3A00%3A00.000Z')
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer pull-secret',
      )
      return new Response(JSON.stringify({ tickets: [sampleTicket] }), {
        status: 200,
      })
    })

    const tickets = await fetchTicketsFromSource({
      config: {
        url: 'https://casal-track.example.com/api/support-tower/export',
        token: 'pull-secret',
      },
      since: new Date('2026-05-01T00:00:00.000Z'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].ticket.externalId).toBe('ct_42')
  })

  it('throws when the upstream responds with an error status', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('boom', { status: 502, statusText: 'Bad Gateway' }),
    )

    await expect(
      fetchTicketsFromSource({
        config: { url: 'https://casal-track.example.com/api', token: 't' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/502/)
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
    })
  })
})

describe('pullSourceApp', () => {
  it('ingests each ticket and counts created vs updated', async () => {
    const ingest = vi
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
      ingest,
      resolveSince: async () => null,
    })

    expect(result.pulled).toBe(2)
    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.errors).toEqual([])
    expect(ingest).toHaveBeenCalledTimes(2)
  })

  it('reports an error when no pull config exists for the slug', async () => {
    const result = await pullSourceApp({
      appSlug: 'pitchme',
      env: envWithCasal,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      ingest: vi.fn(),
      resolveSince: async () => null,
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
      ingest: vi.fn(),
      resolveSince: async () => null,
      logger: { warn: vi.fn() },
    })

    expect(result.pulled).toBe(0)
    expect(result.errors).toEqual(['network down'])
  })

  it('captures per-ticket ingest failures and keeps processing siblings', async () => {
    const ingest = vi
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
      ingest,
      resolveSince: async () => null,
      logger: { warn: vi.fn() },
    })

    expect(result.pulled).toBe(1)
    expect(result.created).toBe(1)
    expect(result.errors).toEqual(['ct_42: db down'])
  })
})
