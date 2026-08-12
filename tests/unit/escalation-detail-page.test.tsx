import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), hasDatabaseUrl: vi.fn(), getDb: vi.fn(), getEscalationDetail: vi.fn(),
  getSourceAppPullConfig: vi.fn(), redirect: vi.fn(), notFound: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/db', () => ({ hasDatabaseUrl: mocks.hasDatabaseUrl, getDb: mocks.getDb }))
vi.mock('@/lib/escalations/detail', () => ({ getEscalationDetail: mocks.getEscalationDetail }))
vi.mock('@/lib/feedback/source-pull', () => ({ getSourceAppPullConfig: mocks.getSourceAppPullConfig }))
vi.mock('@/components/AppShell', () => ({ default: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/escalations/EscalationDetailContent', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT') }),
  notFound: mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

import FeedbackDetailPage from '@/app/feedback/[id]/page'

describe('escalation detail page boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasDatabaseUrl.mockReturnValue(true)
    mocks.auth.mockResolvedValue({ user: { id: 'support-1', role: 'SUPPORT' } })
    mocks.getSourceAppPullConfig.mockReturnValue(null)
  })

  it('redirects before querying detail when the visitor is unauthenticated', async () => {
    mocks.auth.mockResolvedValue(null)

    await expect(FeedbackDetailPage({ params: Promise.resolve({ id: 'ticket-1' }) })).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.getEscalationDetail).not.toHaveBeenCalled()
  })

  it('returns not found when the approved-detail query excludes a direct unapproved ticket URL', async () => {
    mocks.getEscalationDetail.mockResolvedValue(null)

    await expect(FeedbackDetailPage({ params: Promise.resolve({ id: 'ticket-unapproved' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.getEscalationDetail).toHaveBeenCalledOnce()
  })

  it('passes the source app slug through to pull configuration before rendering the detail', async () => {
    mocks.getEscalationDetail.mockResolvedValue({ application: { slug: 'atlas' } })
    mocks.getSourceAppPullConfig.mockReturnValue({ url: 'https://atlas.test/export', token: 'not-rendered' })

    await FeedbackDetailPage({ params: Promise.resolve({ id: 'ticket-1' }) })

    expect(mocks.getSourceAppPullConfig).toHaveBeenCalledWith('atlas')
  })
})
