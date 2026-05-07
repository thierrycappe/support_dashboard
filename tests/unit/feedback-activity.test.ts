import { describe, expect, it } from 'vitest'
import {
  buildActivityKpisData,
  formatDuration,
  startOfUtcWeek,
} from '@/lib/feedback/activity'

const now = new Date('2026-05-07T12:00:00.000Z')

function bugRow(overrides: Record<string, unknown>) {
  return {
    id: 'bug-1',
    title: 'Checkout breaks',
    appName: 'Sales Portal',
    status: 'FIXED',
    remoteCreatedAt: null,
    remoteUpdatedAt: null,
    lastStatusChangeAt: null,
    createdAt: new Date('2026-05-01T08:00:00.000Z'),
    updatedAt: new Date('2026-05-01T08:00:00.000Z'),
    ...overrides,
  } as never
}

describe('activity KPI helpers', () => {
  it('starts UTC weeks on Monday', () => {
    expect(startOfUtcWeek(new Date('2026-05-07T12:00:00.000Z')).toISOString()).toBe(
      '2026-05-04T00:00:00.000Z',
    )
  })

  it('formats short and long durations', () => {
    expect(formatDuration(90 * 60 * 1000)).toBe('1.5h')
    expect(formatDuration(3.5 * 24 * 60 * 60 * 1000)).toBe('3.5d')
    expect(formatDuration(null)).toBe('n/a')
  })

  it('builds resolution runway metrics from ticket timestamps', () => {
    const data = buildActivityKpisData(
      [
        bugRow({
          id: 'current-resolved',
          remoteCreatedAt: new Date('2026-05-04T08:00:00.000Z'),
          lastStatusChangeAt: new Date('2026-05-06T08:00:00.000Z'),
          updatedAt: new Date('2026-05-06T08:00:00.000Z'),
        }),
        bugRow({
          id: 'current-created',
          status: 'NEW',
          remoteCreatedAt: new Date('2026-05-05T08:00:00.000Z'),
          lastStatusChangeAt: null,
          updatedAt: new Date('2026-05-05T08:00:00.000Z'),
        }),
        bugRow({
          id: 'previous-resolved',
          remoteCreatedAt: new Date('2026-03-02T08:00:00.000Z'),
          lastStatusChangeAt: new Date('2026-03-04T20:00:00.000Z'),
          updatedAt: new Date('2026-03-04T20:00:00.000Z'),
        }),
      ],
      [
        bugRow({
          id: 'open-review',
          status: 'IN_REVIEW',
          remoteCreatedAt: new Date('2026-05-05T08:00:00.000Z'),
          lastStatusChangeAt: new Date('2026-05-06T12:00:00.000Z'),
        }),
      ],
      now,
    )

    expect(data.summary.resolvedBugs).toBe('1')
    expect(data.summary.medianCycle).toBe('2.0d')
    expect(data.summary.requesterWait).toBe('2.0d')
    expect(data.statusTimes).toEqual([
      {
        label: 'In Review',
        value: 100,
        time: '1.0d',
      },
    ])
    expect(data.cyclePoints).toHaveLength(1)
  })
})
