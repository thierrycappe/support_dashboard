import { describe, expect, it } from 'vitest'
import {
  constantTimeTokenEquals,
  feedbackIngestSchema,
  getBearerToken,
  getIngestTokenForApp,
  ingestTokenEnvVarForSlug,
  normalizeFeedbackStatus,
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

  it('normalizes source app status and priority labels before validation', () => {
    const parsed = feedbackIngestSchema.parse({
      ...validPayload,
      ticket: {
        ...validPayload.ticket,
        status: 'fixed',
        priority: 'critical',
      },
    })

    expect(parsed.ticket.status).toBe('FIXED')
    expect(parsed.ticket.priority).toBe('URGENT')
  })

  it('maps source app workflow aliases to dashboard statuses', () => {
    expect(normalizeFeedbackStatus('not started')).toBe('NEW')
    expect(normalizeFeedbackStatus('AI_BATCH_FIX')).toBe('IN_PROGRESS')
    expect(normalizeFeedbackStatus('corrigé')).toBe('FIXED')
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

  it('resolves a per-app token env var by normalized slug', () => {
    expect(
      getIngestTokenForApp('casal-track', {
        SUPPORT_TOWER_INGEST_TOKEN_CASAL_TRACK: 'casal-token',
      }),
    ).toBe('casal-token')
  })

  it('returns null when no per-app token env var is set for the slug', () => {
    expect(
      getIngestTokenForApp('unknown-app', {
        SUPPORT_TOWER_INGEST_TOKEN_CASAL_TRACK: 'casal-token',
      }),
    ).toBeNull()
  })

  it('ignores the removed legacy JSON map and shared token', () => {
    expect(
      getIngestTokenForApp('sales-portal', {
        SUPPORT_TOWER_INGEST_TOKENS_JSON: JSON.stringify({ 'sales-portal': 'json-token' }),
        SUPPORT_TOWER_INGEST_TOKEN: 'legacy-token',
      }),
    ).toBeNull()
  })

  it('maps slugs to env keys by upper-casing and replacing hyphens', () => {
    expect(ingestTokenEnvVarForSlug('pichon-bi-feedback')).toBe(
      'SUPPORT_TOWER_INGEST_TOKEN_PICHON_BI_FEEDBACK',
    )
    expect(ingestTokenEnvVarForSlug('csm')).toBe('SUPPORT_TOWER_INGEST_TOKEN_CSM')
  })

  it('compares bearer tokens without accepting prefixes', () => {
    expect(constantTimeTokenEquals('sales-token', 'sales-token')).toBe(true)
    expect(constantTimeTokenEquals('sales-token-extra', 'sales-token')).toBe(false)
  })
})
