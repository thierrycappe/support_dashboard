import { describe, expect, it } from 'vitest'
import {
  constantTimeTokenEquals,
  feedbackIngestSchema,
  getBearerToken,
  getIngestTokenForApp,
} from '@/lib/feedback/ingest'

const validPayload = {
  app: {
    slug: 'sales-portal',
    name: 'Sales Portal',
    baseUrl: 'https://sales.example.com',
    environment: 'production',
  },
  ticket: {
    externalId: 'fb_123',
    kind: 'EVOLUTION',
    status: 'PLANNED',
    priority: 'HIGH',
    title: 'Add regional filters',
    description: 'Teams need to filter the dashboard by region.',
    reporterEmail: 'user@example.com',
    markdownSpec: '# Add regional filters',
    transcript: [{ role: 'user', content: 'I need a region filter.' }],
  },
}

describe('feedback ingest contract', () => {
  it('accepts a normalized feedback payload from a source app', () => {
    const parsed = feedbackIngestSchema.safeParse(validPayload)
    expect(parsed.success).toBe(true)
  })

  it('rejects invalid source app slugs', () => {
    const parsed = feedbackIngestSchema.safeParse({
      ...validPayload,
      app: { ...validPayload.app, slug: 'Sales Portal' },
    })
    expect(parsed.success).toBe(false)
  })

  it('extracts bearer tokens from authorization headers', () => {
    const headers = new Headers({ authorization: 'Bearer test-token' })
    expect(getBearerToken(headers)).toBe('test-token')
  })

  it('resolves per-app ingest tokens from the JSON token map', () => {
    const token = getIngestTokenForApp('sales-portal', {
      SUPPORT_TOWER_INGEST_TOKENS_JSON: JSON.stringify({
        'sales-portal': 'sales-token',
        csm: 'csm-token',
      }),
      SUPPORT_TOWER_INGEST_TOKEN: 'legacy-token',
    })

    expect(token).toBe('sales-token')
  })

  it('does not fall back to the legacy shared token when a JSON token map is configured', () => {
    const token = getIngestTokenForApp('unknown-app', {
      SUPPORT_TOWER_INGEST_TOKENS_JSON: JSON.stringify({
        csm: 'csm-token',
      }),
      SUPPORT_TOWER_INGEST_TOKEN: 'legacy-token',
    })

    expect(token).toBeNull()
  })

  it('falls back to the legacy shared token when no JSON token map is configured', () => {
    const token = getIngestTokenForApp('sales-portal', {
      SUPPORT_TOWER_INGEST_TOKEN: 'legacy-token',
    })

    expect(token).toBe('legacy-token')
  })

  it('compares bearer tokens without accepting prefixes', () => {
    expect(constantTimeTokenEquals('sales-token', 'sales-token')).toBe(true)
    expect(constantTimeTokenEquals('sales-token-extra', 'sales-token')).toBe(false)
  })
})
