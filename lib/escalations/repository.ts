import { and, eq } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db'
import {
  appNotificationPolicies,
  notificationChannels,
  sourceApps,
  supportGroups,
} from '@/lib/db/schema'
import { resolveDeliveryTargets } from '@/lib/delivery/policy'
import type { RoutableChannel, RoutingDecision } from '@/lib/delivery/types'
import type { FeedbackPriority } from '@/lib/feedback/status'

export async function resolveTargetsFromDb(
  tx: DbTransaction,
  appId: string,
  priority: FeedbackPriority,
): Promise<RoutingDecision> {
  const appRows = await tx
    .select({
      status: sourceApps.status,
      technicalGroupId: sourceApps.technicalGroupId,
      minimumPriority: appNotificationPolicies.minimumPriority,
    })
    .from(sourceApps)
    .leftJoin(
      appNotificationPolicies,
      eq(appNotificationPolicies.sourceAppId, sourceApps.id),
    )
    .where(eq(sourceApps.id, appId))
    .limit(1)
  const app = appRows[0]

  const appChannels = app?.status === 'ACTIVE' && app.technicalGroupId
    ? await channelsForGroup(tx, app.technicalGroupId, app.minimumPriority ?? 'MEDIUM')
    : []
  // The pure delivery policy decides whether central is selected: it is always
  // included for urgent events and is the fallback whenever app channels yield
  // no valid target. The retired boolean must not turn a no-target escalation
  // into an invisible incident.
  const centralChannels = await centralFallbackChannels(tx)

  return resolveDeliveryTargets({ priority, appChannels, centralChannels })
}

async function channelsForGroup(
  tx: DbTransaction,
  groupId: string,
  minimumPriority: FeedbackPriority,
): Promise<RoutableChannel[]> {
  const rows = await tx
    .select({
      id: notificationChannels.id,
      type: notificationChannels.type,
      status: notificationChannels.status,
      includeReporterContext: notificationChannels.includeReporterContext,
    })
    .from(notificationChannels)
    .innerJoin(supportGroups, eq(supportGroups.id, notificationChannels.groupId))
    .where(and(
      eq(notificationChannels.groupId, groupId),
      eq(supportGroups.status, 'ACTIVE'),
    ))

  return rows.map((channel) => ({
    targetKey: `channel:${channel.id}`,
    channelId: channel.id,
    channelType: channel.type,
    configSource: 'DATABASE',
    includeReporterContext: channel.includeReporterContext,
    status: channel.status,
    minimumPriority,
  }))
}

async function centralFallbackChannels(tx: DbTransaction): Promise<RoutableChannel[]> {
  const centralGroupRows = await tx
    .select({ id: supportGroups.id })
    .from(supportGroups)
    .where(and(
      eq(supportGroups.isCentralFallback, true),
      eq(supportGroups.status, 'ACTIVE'),
    ))
    .limit(1)
  const centralGroup = centralGroupRows[0]

  if (!centralGroup) return []
  return channelsForGroup(tx, centralGroup.id, 'LOW')
}
