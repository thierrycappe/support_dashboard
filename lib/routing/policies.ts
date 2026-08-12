import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent, type AuditMutationContext } from '@/lib/audit/events'
import { getDb, type Db } from '@/lib/db'
import { appNotificationPolicies, notificationChannels, sourceApps, supportGroups } from '@/lib/db/schema'
import { publicChannel, type PublicChannel } from '@/lib/routing/channels'
import type { FeedbackPriority } from '@/lib/feedback/status'

export interface PublicAppPolicy {
  sourceAppId: string
  minimumPriority: FeedbackPriority
  urgentCentralCopy: boolean
  fallbackToCentral: boolean
}

export interface RoutingContext {
  sourceAppId: string
  technicalGroupId: string | null
  policy: PublicAppPolicy | null
  technicalChannels: PublicChannel[]
  centralChannels: PublicChannel[]
}

export async function setAppPolicy({
  db = getDb(), sourceAppId, technicalGroupId, minimumPriority,
  urgentCentralCopy, fallbackToCentral, ...audit
}: AuditMutationContext & {
  db?: Db
  sourceAppId: string
  technicalGroupId: string | null
  minimumPriority: FeedbackPriority
  urgentCentralCopy: boolean
  fallbackToCentral: boolean
}): Promise<PublicAppPolicy> {
  const now = new Date()
  const policy: PublicAppPolicy = { sourceAppId, minimumPriority, urgentCentralCopy, fallbackToCentral }
  await db.transaction(async (tx) => {
    const app = await tx.update(sourceApps).set({ technicalGroupId, updatedAt: now })
      .where(eq(sourceApps.id, sourceAppId)).returning({ id: sourceApps.id })
    if (!app[0]) throw new Error('Source app not found')
    await tx.insert(appNotificationPolicies).values({
      id: nanoid(), sourceAppId, minimumPriority, urgentCentralCopy, fallbackToCentral,
      createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: appNotificationPolicies.sourceAppId,
      set: { minimumPriority, urgentCentralCopy, fallbackToCentral, updatedAt: now },
    })
    await appendAuditEvent({
      db: tx, ...audit, action: 'APP_POLICY_SET', subjectType: 'source_app', subjectId: sourceAppId,
      metadata: { technicalGroupId, minimumPriority, urgentCentralCopy, fallbackToCentral }, now,
    })
  })
  return policy
}

export async function getRoutingContext({
  db = getDb(), sourceAppId,
}: { db?: Db; sourceAppId: string }): Promise<RoutingContext> {
  const appRows = await db.select({ technicalGroupId: sourceApps.technicalGroupId })
    .from(sourceApps).where(eq(sourceApps.id, sourceAppId)).limit(1)
  const app = appRows[0]
  if (!app) throw new Error('Source app not found')
  const policies = await db.select().from(appNotificationPolicies)
    .where(eq(appNotificationPolicies.sourceAppId, sourceAppId)).limit(1)
  const policyRow = policies[0]
  const central = await db.select({ id: supportGroups.id }).from(supportGroups)
    .where(and(eq(supportGroups.isCentralFallback, true), eq(supportGroups.status, 'ACTIVE'))).limit(1)
  return {
    sourceAppId,
    technicalGroupId: app.technicalGroupId,
    policy: policyRow ? {
      sourceAppId, minimumPriority: policyRow.minimumPriority, urgentCentralCopy: policyRow.urgentCentralCopy,
      fallbackToCentral: policyRow.fallbackToCentral,
    } : null,
    technicalChannels: app.technicalGroupId ? await channelsForGroup(db, app.technicalGroupId) : [],
    centralChannels: central[0] ? await channelsForGroup(db, central[0].id) : [],
  }
}

async function channelsForGroup(db: Db, groupId: string): Promise<PublicChannel[]> {
  const rows = await db.select({
    id: notificationChannels.id, groupId: notificationChannels.groupId, name: notificationChannels.name,
    type: notificationChannels.type, status: notificationChannels.status, recipientDisplay: notificationChannels.recipientDisplay,
    redactedDestination: notificationChannels.redactedDestination, includeReporterContext: notificationChannels.includeReporterContext,
    lastSucceededAt: notificationChannels.lastSucceededAt, lastFailedAt: notificationChannels.lastFailedAt,
  }).from(notificationChannels).where(eq(notificationChannels.groupId, groupId))
  return rows.map(publicChannel)
}
