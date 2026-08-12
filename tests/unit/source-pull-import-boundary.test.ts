import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/escalations/legacy', () => {
  throw new Error('legacy intake graph loaded eagerly')
})

describe('source pull import boundary', () => {
  it('can load configuration and transport helpers without loading server-only legacy intake', async () => {
    const sourcePull = await import('@/lib/feedback/source-pull')

    expect(sourcePull.listConfiguredPullSlugs({})).toEqual([])
    expect(sourcePull.fetchTicketsFromSource).toEqual(expect.any(Function))
  })
})
