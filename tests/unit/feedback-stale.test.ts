import { describe, expect, it } from 'vitest'
import { STALE_AFTER_HOURS, isStaleTicket } from '@/lib/feedback/status'

const now = new Date('2026-05-12T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)

describe('isStaleTicket', () => {
  it('flags open tickets whose last sync exceeds the threshold', () => {
    expect(
      isStaleTicket(
        { status: 'IN_PROGRESS', lastSyncedAt: hoursAgo(STALE_AFTER_HOURS + 1) },
        now,
      ),
    ).toBe(true)
  })

  it('does not flag open tickets that synced within the threshold', () => {
    expect(
      isStaleTicket(
        { status: 'IN_PROGRESS', lastSyncedAt: hoursAgo(STALE_AFTER_HOURS - 1) },
        now,
      ),
    ).toBe(false)
  })

  it('never flags terminal-status tickets even if stale', () => {
    expect(
      isStaleTicket(
        { status: 'CLOSED', lastSyncedAt: hoursAgo(STALE_AFTER_HOURS * 10) },
        now,
      ),
    ).toBe(false)
    expect(
      isStaleTicket(
        { status: 'FIXED', lastSyncedAt: hoursAgo(STALE_AFTER_HOURS * 10) },
        now,
      ),
    ).toBe(false)
  })

  it('does not flag tickets that have never been synced', () => {
    expect(isStaleTicket({ status: 'NEW', lastSyncedAt: null }, now)).toBe(false)
  })

  it('honors a custom threshold override', () => {
    expect(
      isStaleTicket(
        { status: 'NEW', lastSyncedAt: hoursAgo(3) },
        now,
        2,
      ),
    ).toBe(true)
  })
})
