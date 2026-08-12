import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChannelEditor from '@/components/teams/ChannelEditor'
import GroupEditor from '@/components/teams/GroupEditor'

const action = vi.fn()

describe('team operations editors', () => {
  it('keeps group ownership explicit and provides a factual empty membership state', () => {
    render(
      <GroupEditor
        action={action}
        groups={[{
          id: 'group-platform', name: 'Platform reliability', status: 'ACTIVE', isCentralFallback: true,
          members: [],
        }]}
        users={[{ id: 'user-maya', name: 'Maya Chen', email: 'maya@example.test' }]}
        membershipAction={action}
      />,
    )

    expect(screen.getByText('Platform reliability')).toBeVisible()
    expect(screen.getByText('Central fallback')).toBeVisible()
    expect(screen.getByText(/members appear when a support user or recipient is assigned/i)).toBeVisible()
    expect(screen.getByLabelText('Technical group name')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /Maya Chen/ })).toBeVisible()
    expect(screen.getByLabelText('External recipient references')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save group members' })).toBeVisible()
  })

  it('shows channel health and a redacted destination without rendering configuration secrets', () => {
    render(
      <ChannelEditor
        action={action}
        groups={[{ id: 'group-platform', name: 'Platform reliability' }]}
        channels={[{
          id: 'channel-release', groupId: 'group-platform', name: 'Release alerts', type: 'WEBHOOK',
          status: 'UNHEALTHY', destination: 'Webhook hooks.example.test', includeReporterContext: false,
          lastSuccessAt: null, lastFailureAt: new Date('2026-08-12T13:00:00.000Z'),
        }]}
        replaceAction={action}
      />,
    )

    expect(screen.getByText('Unhealthy')).toBeVisible()
    expect(screen.getByText('Webhook hooks.example.test')).toBeVisible()
    expect(screen.queryByText(/signingSecret|ciphertext|appToken/i)).toBeNull()
    expect(screen.getByLabelText('Alert channel name')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Replace channel configuration' })).toBeVisible()
  })
})
