import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent } from '@/lib/audit/events'
import { getDb, type Db, type DbTransaction } from '@/lib/db'
import {
  appNotificationPolicies,
  notificationChannels,
  sourceApps,
  supportGroups,
  supportSettings,
} from '@/lib/db/schema'
import { getPushoverConfig } from '@/lib/notifications/pushover'
import { encryptChannelConfig, loadChannelKeyring } from '@/lib/routing/crypto'

type Env = Record<string, string | undefined>
const CUTOVER_LOCK = 'support-tower-routing-cutover'
const RETIRED_MARKER = 'legacy_pushover_bridge_retired_at'

export interface BackfillSummary {
  centralGroupsCreated: number
  channelsCreated: number
  policiesCreated: number
  appsChanged: number
  bridgeRetired: boolean
}

export async function backfillSupportRouting({
  db = getDb(),
  env = process.env,
  actorId,
  onRoutingLock,
}: {
  db?: Db
  env?: Env
  actorId: string
  onRoutingLock?: () => Promise<void>
}): Promise<BackfillSummary> {
  const pushover = getPushoverConfig(env)
  const keyring = pushover ? loadChannelKeyring(env) : null
  if (pushover && !keyring) throw new Error('Channel encryption keyring is required for Pushover cutover')

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${CUTOVER_LOCK}))`)
    await onRoutingLock?.()
    const now = new Date()
    const summary: BackfillSummary = {
      centralGroupsCreated: 0, channelsCreated: 0, policiesCreated: 0, appsChanged: 0, bridgeRetired: false,
    }
    const centralGroup = await centralFallbackGroup(tx, now, summary)
    const channel = pushover && keyring
      ? await centralPushoverChannel(tx, centralGroup.id, pushover, keyring, now, summary)
      : null
    const apps = await tx.select({ id: sourceApps.id, technicalGroupId: sourceApps.technicalGroupId, credentialMode: sourceApps.credentialMode })
      .from(sourceApps).for('update')

    for (const app of apps) {
      const policy = await tx.select({ id: appNotificationPolicies.id }).from(appNotificationPolicies)
        .where(sql`${appNotificationPolicies.sourceAppId} = ${app.id}`).limit(1)
      const appChanged = app.technicalGroupId === null || app.credentialMode !== 'LEGACY_BEARER'
      if (appChanged) {
        await tx.update(sourceApps).set({ technicalGroupId: app.technicalGroupId ?? centralGroup.id, credentialMode: 'LEGACY_BEARER', updatedAt: now })
          .where(sql`${sourceApps.id} = ${app.id}`)
        summary.appsChanged += 1
        await appendAuditEvent({
          db: tx, actorId, correlationId: `routing-backfill:${app.id}`, reason: 'legacy routing cutover',
          action: 'SUPPORT_ROUTING_BACKFILLED', subjectType: 'source_app', subjectId: app.id,
          metadata: { assignedCentralFallback: app.technicalGroupId === null, credentialMode: 'LEGACY_BEARER' }, now,
        })
      }
      // Policies make the resolver choose database routing. Do not install
      // them until the encrypted central target exists, otherwise a partial
      // Pushover environment would disable the still-active legacy bridge.
      if (channel && !policy[0]) {
        await tx.insert(appNotificationPolicies).values({
          id: nanoid(), sourceAppId: app.id, minimumPriority: 'LOW', urgentCentralCopy: true, fallbackToCentral: true, createdAt: now, updatedAt: now,
        })
        summary.policiesCreated += 1
      }
    }

    if (channel) {
      const retired = await tx.insert(supportSettings).values({ key: RETIRED_MARKER, value: now.toISOString(), updatedAt: now })
        .onConflictDoNothing().returning({ key: supportSettings.key })
      summary.bridgeRetired = retired.length > 0
    }
    return summary
  }, { isolationLevel: 'serializable', accessMode: 'read write' })
}

async function centralFallbackGroup(tx: DbTransaction, now: Date, summary: BackfillSummary): Promise<{ id: string }> {
  const existing = await tx.select({ id: supportGroups.id }).from(supportGroups)
    .where(sql`${supportGroups.isCentralFallback} = true`).for('update').limit(1)
  if (existing[0]) return existing[0]
  const id = nanoid()
  await tx.insert(supportGroups).values({ id, name: 'Central support', status: 'ACTIVE', isCentralFallback: true, createdAt: now, updatedAt: now })
  summary.centralGroupsCreated += 1
  return { id }
}

async function centralPushoverChannel(
  tx: DbTransaction,
  groupId: string,
  config: { appToken: string; userKey: string },
  keyring: NonNullable<ReturnType<typeof loadChannelKeyring>>,
  now: Date,
  summary: BackfillSummary,
): Promise<{ id: string }> {
  const existing = await tx.select({ id: notificationChannels.id }).from(notificationChannels)
    .where(sql`${notificationChannels.groupId} = ${groupId} and ${notificationChannels.name} = 'Central Pushover'`).for('update').limit(1)
  if (existing[0]) return existing[0]
  const id = nanoid()
  const encrypted = encryptChannelConfig({ type: 'PUSHOVER', ...config }, { channelId: id, type: 'PUSHOVER' }, keyring)
  await tx.insert(notificationChannels).values({
    id, groupId, name: 'Central Pushover', type: 'PUSHOVER', status: 'ACTIVE',
    encryptedConfig: encrypted.ciphertext, configNonce: encrypted.nonce, configAuthTag: encrypted.authTag,
    keyVersion: Number(encrypted.keyVersion.slice(1)), recipientDisplay: 'Pushover recipient', redactedDestination: 'Pushover recipient',
    includeReporterContext: false, createdAt: now, updatedAt: now,
  })
  summary.channelsCreated += 1
  return { id }
}

async function main(): Promise<void> {
  const summary = await backfillSupportRouting({ actorId: process.env.SUPPORT_TOWER_BACKFILL_ACTOR_ID?.trim() || 'support-routing-backfill' })
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Backfill failed'}\n`)
    process.exitCode = 1
  })
}
