import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  requireDeliveryRetryUser: vi.fn(),
  hasDatabaseUrl: vi.fn(),
  getDeliveryOperations: vi.fn(),
  getAuditHistory: vi.fn(),
  listSupportUsers: vi.fn(),
  listCredentialSecurity: vi.fn(),
  listTeamOperations: vi.fn(),
  getApplications: vi.fn(),
  getApplicationDetail: vi.fn(),
}))

vi.mock('@/lib/auth/guards', () => ({
  requireAdminUser: mocks.requireAdminUser,
  requireDeliveryRetryUser: mocks.requireDeliveryRetryUser,
}))
vi.mock('@/lib/db', () => ({ hasDatabaseUrl: mocks.hasDatabaseUrl }))
vi.mock('@/lib/delivery/queries', () => ({ getDeliveryOperations: mocks.getDeliveryOperations }))
vi.mock('@/lib/audit/queries', () => ({ getAuditHistory: mocks.getAuditHistory, listCredentialSecurity: mocks.listCredentialSecurity }))
vi.mock('@/lib/auth/users', () => ({ listSupportUsers: mocks.listSupportUsers }))
vi.mock('@/lib/routing/groups', () => ({ listTeamOperations: mocks.listTeamOperations }))
vi.mock('@/lib/apps/queries', () => ({ getApplications: mocks.getApplications, getApplicationDetail: mocks.getApplicationDetail }))
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/components/AppShell', () => ({ default: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/deliveries/DeliveryTable', () => ({ default: () => null }))
vi.mock('@/components/teams/GroupEditor', () => ({ default: () => null }))
vi.mock('@/components/teams/ChannelEditor', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ children }: { children: unknown }) => children }))

import DeliveriesPage from '@/app/deliveries/page'
import TeamsPage from '@/app/teams/page'
import AccessPage from '@/app/access/page'
import UsersPage from '@/app/users/page'
import AppsPage from '@/app/apps/page'
import ApplicationDetailPage from '@/app/apps/[id]/page'

const admin = { id: 'admin-1', role: 'ADMIN' }
const support = { id: 'support-1', role: 'SUPPORT' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminUser.mockResolvedValue(admin)
  mocks.requireDeliveryRetryUser.mockResolvedValue(admin)
  mocks.hasDatabaseUrl.mockReturnValue(true)
  mocks.getDeliveryOperations.mockResolvedValue({ rows: [], summary: { deadLetters: 0, routingIncidents: 0, unhealthyChannels: 0 }, nextCursor: null })
  mocks.getAuditHistory.mockResolvedValue({ rows: [], nextCursor: null })
  mocks.listSupportUsers.mockResolvedValue([])
  mocks.listCredentialSecurity.mockResolvedValue([])
  mocks.listTeamOperations.mockResolvedValue({ groups: [], channels: [] })
  mocks.getApplications.mockResolvedValue([])
  mocks.getApplicationDetail.mockResolvedValue({
    id: 'app-1', name: 'Amber checkout', slug: 'amber', baseUrl: null, environment: 'test', status: 'ACTIVE', enrollmentStatus: 'PENDING', credentialMode: 'PUBLIC_KEY', groupName: 'Platform', openCount: 0, lastAuthenticatedAt: null, slugLocked: true, minimumPriority: null, urgentCentralCopy: null, fallbackToCentral: null, owners: [], invitation: null,
  })
})

describe('operations page access boundaries', () => {
  it('permits support to inspect delivery status but not administrative surfaces', async () => {
    mocks.requireDeliveryRetryUser.mockResolvedValue(support)
    await expect(DeliveriesPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()

    mocks.requireAdminUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(TeamsPage()).rejects.toThrow('NEXT_REDIRECT')
    await expect(AccessPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT')
    await expect(UsersPage()).rejects.toThrow('NEXT_REDIRECT')
    await expect(AppsPage()).rejects.toThrow('NEXT_REDIRECT')
    await expect(ApplicationDetailPage({ params: Promise.resolve({ id: 'app-1' }) })).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.getApplications).not.toHaveBeenCalled()
    expect(mocks.getApplicationDetail).not.toHaveBeenCalled()
  })

  it('denies unauthenticated delivery inspection before loading operations data', async () => {
    mocks.requireDeliveryRetryUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(DeliveriesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.getDeliveryOperations).not.toHaveBeenCalled()
  })

  it('loads teams, access credentials, audit history, and users for an admin only', async () => {
    await expect(TeamsPage()).resolves.toBeTruthy()
    await expect(AccessPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
    await expect(UsersPage()).resolves.toBeTruthy()
    await expect(AppsPage()).resolves.toBeTruthy()
    await expect(ApplicationDetailPage({ params: Promise.resolve({ id: 'app-1' }) })).resolves.toBeTruthy()
    expect(mocks.listTeamOperations).toHaveBeenCalledOnce()
    expect(mocks.listCredentialSecurity).toHaveBeenCalledOnce()
    expect(mocks.getAuditHistory).toHaveBeenCalledOnce()
    expect(mocks.listSupportUsers).toHaveBeenCalledTimes(2)
    expect(mocks.getApplications).toHaveBeenCalledOnce()
    expect(mocks.getApplicationDetail).toHaveBeenCalledOnce()
  })
})
