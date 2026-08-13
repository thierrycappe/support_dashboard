import { describe, expect, it } from 'vitest'
import { resolveDeliveryTargets } from '@/lib/delivery/policy'

const appEmail = {
  targetKey: 'channel:app-email',
  channelId: 'app-email',
  channelType: 'EMAIL' as const,
  configSource: 'DATABASE' as const,
  status: 'ACTIVE' as const,
  minimumPriority: 'MEDIUM' as const,
  includeReporterContext: false,
}

const centralPushover = {
  targetKey: 'channel:central-pushover',
  channelId: 'central-pushover',
  channelType: 'PUSHOVER' as const,
  configSource: 'DATABASE' as const,
  status: 'ACTIVE' as const,
  minimumPriority: 'LOW' as const,
  includeReporterContext: false,
}

const highFixture = {
  priority: 'HIGH' as const,
  appChannels: [appEmail],
  centralChannels: [centralPushover],
}

const urgentFixture = { ...highFixture, priority: 'URGENT' as const }

const disabledFixture = {
  ...highFixture,
  appChannels: [{ ...appEmail, status: 'DISABLED' as const }],
}

describe('resolveDeliveryTargets', () => {
  it('routes a high-priority escalation to the app group only', () => {
    expect(resolveDeliveryTargets(highFixture).targets.map((target) => target.channelId)).toEqual([
      'app-email',
    ])
  })

  it('returns only the delivery target contract', () => {
    expect(resolveDeliveryTargets(highFixture).targets).toEqual([
      {
        targetKey: 'channel:app-email',
        channelId: 'app-email',
        channelType: 'EMAIL',
        configSource: 'DATABASE',
        includeReporterContext: false,
      },
    ])
  })

  it('copies urgent escalations to the central fallback without duplicates', () => {
    expect(resolveDeliveryTargets(urgentFixture).targets.map((target) => target.channelId)).toEqual([
      'app-email',
      'central-pushover',
    ])
  })

  it('uses central fallback when every app channel is disabled', () => {
    expect(resolveDeliveryTargets(disabledFixture).targets.map((target) => target.channelId)).toEqual([
      'central-pushover',
    ])
  })

  it('returns an explicit unroutable incident when no valid target exists', () => {
    expect(resolveDeliveryTargets({
      priority: 'HIGH',
      appChannels: [],
      centralChannels: [],
    })).toEqual({
      targets: [],
      incident: { code: 'NO_VALID_DELIVERY_TARGET' },
    })
  })

  it('excludes inactive and minimum-priority-ineligible central channels', () => {
    expect(resolveDeliveryTargets({
      priority: 'HIGH',
      appChannels: [{ ...appEmail, status: 'UNHEALTHY' }],
      centralChannels: [
        { ...centralPushover, status: 'DISABLED' },
        { ...centralPushover, targetKey: 'channel:central-urgent', channelId: 'central-urgent', minimumPriority: 'URGENT' },
      ],
    })).toEqual({
      targets: [],
      incident: { code: 'NO_VALID_DELIVERY_TARGET' },
    })
  })

  it('deduplicates by target key and uses target-key order within each destination group', () => {
    expect(resolveDeliveryTargets({
      priority: 'URGENT',
      appChannels: [
        { ...appEmail, targetKey: 'channel:z-app', channelId: 'z-app' },
        { ...appEmail, targetKey: 'channel:a-app', channelId: 'a-app' },
      ],
      centralChannels: [
        { ...centralPushover, targetKey: 'channel:z-app', channelId: 'duplicate-central' },
        { ...centralPushover, targetKey: 'channel:b-central', channelId: 'b-central' },
      ],
    }).targets.map((target) => target.channelId)).toEqual([
      'a-app',
      'z-app',
      'b-central',
    ])
  })
})
