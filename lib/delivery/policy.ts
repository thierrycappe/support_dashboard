import { priorityWeight } from '@/lib/feedback/status'
import type {
  DeliveryTarget,
  RoutableChannel,
  RoutingDecision,
  RoutingInput,
} from '@/lib/delivery/types'

function compareChannels(left: RoutableChannel, right: RoutableChannel): number {
  return left.targetKey.localeCompare(right.targetKey)
    || (left.channelId ?? '').localeCompare(right.channelId ?? '')
    || left.channelType.localeCompare(right.channelType)
    || left.configSource.localeCompare(right.configSource)
}

function validTargets(
  channels: RoutableChannel[],
  priority: RoutingInput['priority'],
): RoutableChannel[] {
  return channels
    .filter((channel) => (
      channel.status === 'ACTIVE'
      && priorityWeight(priority) >= priorityWeight(channel.minimumPriority)
    ))
    .sort(compareChannels)
}

function dedupeByTargetKey<T extends DeliveryTarget>(targets: T[]): T[] {
  const seen = new Set<string>()

  return targets.filter((target) => {
    if (seen.has(target.targetKey)) return false
    seen.add(target.targetKey)
    return true
  })
}

function toDeliveryTarget(channel: RoutableChannel): DeliveryTarget {
  return {
    targetKey: channel.targetKey,
    channelId: channel.channelId,
    channelType: channel.channelType,
    configSource: channel.configSource,
    includeReporterContext: channel.includeReporterContext,
  }
}

export function resolveDeliveryTargets(input: RoutingInput): RoutingDecision {
  const appTargets = validTargets(input.appChannels, input.priority)
  const needsCentral = input.priority === 'URGENT' || appTargets.length === 0
  const targets = dedupeByTargetKey(needsCentral
    ? [...appTargets, ...validTargets(input.centralChannels, input.priority)]
    : appTargets,
  ).map(toDeliveryTarget)

  return {
    targets,
    incident: targets.length === 0 ? { code: 'NO_VALID_DELIVERY_TARGET' } : null,
  }
}
