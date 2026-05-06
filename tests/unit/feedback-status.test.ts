import { describe, expect, it } from 'vitest'
import { isOpenStatus, priorityWeight, visibleStatusLabel } from '@/lib/feedback/status'

describe('feedback status helpers', () => {
  it('classifies active statuses as open', () => {
    expect(isOpenStatus('NEW')).toBe(true)
    expect(isOpenStatus('IN_PROGRESS')).toBe(true)
    expect(isOpenStatus('SHIPPED')).toBe(false)
  })

  it('provides stable display labels', () => {
    expect(visibleStatusLabel('IN_REVIEW')).toBe('In review')
    expect(visibleStatusLabel('BACKLOG')).toBe('Backlog')
  })

  it('orders urgent feedback above lower priorities', () => {
    expect(priorityWeight('URGENT')).toBeGreaterThan(priorityWeight('HIGH'))
    expect(priorityWeight('HIGH')).toBeGreaterThan(priorityWeight('MEDIUM'))
  })
})
