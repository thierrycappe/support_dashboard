import { describe, expect, it } from 'vitest'
import { normalizeDashboardTotals } from '@/lib/feedback/dashboard'

describe('feedback dashboard data', () => {
  it('normalizes aggregate totals from database rows', () => {
    expect(
      normalizeDashboardTotals({
        open: '125',
        bugs: 80,
        evolutions: '45',
        urgent: null,
      }),
    ).toEqual({
      open: 125,
      bugs: 80,
      evolutions: 45,
      urgent: 0,
    })
  })
})
