import { describe, expect, it } from 'vitest'
import { feedbackIngestSchema, getBearerToken } from '@/lib/feedback/ingest'

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
})
