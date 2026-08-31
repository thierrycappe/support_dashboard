import { describe, expect, it } from 'vitest'
import { getConnectorStatus } from '@/lib/feedback/connector-status'

const pullJson = JSON.stringify({
  sparksite: { url: 'https://sparksite.example.com/api/support-tower/export', token: 't' },
})

describe('getConnectorStatus', () => {
  it('derives the ingest env var from the slug', () => {
    expect(getConnectorStatus('pichon-bi-feedback', {}).ingestEnvVar).toBe(
      'SUPPORT_TOWER_INGEST_TOKEN_PICHON_BI_FEEDBACK',
    )
  })

  it('reports both halves configured', () => {
    const status = getConnectorStatus('sparksite', {
      SUPPORT_TOWER_INGEST_TOKEN_SPARKSITE: 'secret',
      SUPPORT_TOWER_SOURCE_APP_PULL_JSON: pullJson,
    })
    expect(status.ingestConfigured).toBe(true)
    expect(status.pullConfigured).toBe(true)
    expect(status.pullUrl).toContain('/api/support-tower/export')
  })

  it('reports push configured but pull missing', () => {
    const status = getConnectorStatus('sparksite', {
      SUPPORT_TOWER_INGEST_TOKEN_SPARKSITE: 'secret',
    })
    expect(status.ingestConfigured).toBe(true)
    expect(status.pullConfigured).toBe(false)
  })

  it('treats a blank token as unconfigured', () => {
    expect(
      getConnectorStatus('sparksite', { SUPPORT_TOWER_INGEST_TOKEN_SPARKSITE: '   ' }).ingestConfigured,
    ).toBe(false)
  })

  it('does not throw on malformed pull JSON', () => {
    expect(
      getConnectorStatus('sparksite', { SUPPORT_TOWER_SOURCE_APP_PULL_JSON: '{not json' }).pullConfigured,
    ).toBe(false)
  })

  // The ingest route recovers the slug from the env var name by mapping `_`
  // back to `-`, so slugs that do not survive that round-trip can never
  // authenticate however correct the token is.
  it('accepts slugs that survive the env-var round-trip', () => {
    for (const slug of ['sparksite', 'pitchme', 'casal-track', 'pichon-bi-feedback', 'app-1']) {
      expect(getConnectorStatus(slug, {}).slugRoundTrips).toBe(true)
    }
  })

  it('flags a slug whose consecutive hyphens collapse', () => {
    expect(getConnectorStatus('my--app', {}).slugRoundTrips).toBe(false)
  })
})
