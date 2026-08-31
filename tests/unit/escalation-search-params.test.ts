import { describe, expect, it } from 'vitest'
import { buildEscalationQueueHref, decodeEscalationCursor, encodeEscalationCursor, parseEscalationSearchParams } from '@/lib/escalations/search-params'

describe('escalation queue URL state', () => {
  it('normalizes valid filters and drops invalid or repeated values safely', () => {
    expect(parseEscalationSearchParams({
      search: '  timeout  ', app: 'app-one', priority: 'URGENT', status: 'IN_REVIEW', cursor: 'invalid',
    })).toEqual({ search: 'timeout', appId: 'app-one', priority: 'URGENT', status: 'IN_REVIEW', limit: 50 })
    expect(parseEscalationSearchParams({ search: ['one', 'two'], priority: 'extreme', status: 'unknown', app: '' }))
      .toEqual({ limit: 50 })
  })

  it('round-trips an opaque exact timestamp and id cursor and rejects altered shapes', () => {
    const value = { updatedAt: new Date('2026-08-12T12:34:56.789Z'), id: 'ticket:50' }
    const encoded = encodeEscalationCursor(value)
    expect(encoded).not.toContain('ticket:50')
    expect(decodeEscalationCursor(encoded)).toEqual(value)
    expect(decodeEscalationCursor(Buffer.from(JSON.stringify({ v: 2, t: value.updatedAt.toISOString(), id: value.id })).toString('base64url'))).toBeNull()
    expect(decodeEscalationCursor('not-a-cursor')).toBeNull()
  })

  it('builds stable GET links without stale cursors when filters change', () => {
    expect(buildEscalationQueueHref({ search: 'power %', appId: 'app-one', priority: 'HIGH', status: 'NEW', limit: 50 }, 'next-cursor'))
      .toBe('/?search=power+%25&app=app-one&priority=HIGH&status=NEW&cursor=next-cursor')
  })
})
