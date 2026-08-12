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
import { decryptChannelConfig, encryptChannelConfig, loadChannelKeyring, type ChannelKeyring } from '@/lib/routing/crypto'
import { LEGACY_PUSHOVER_BRIDGE_RETIRED_MARKER, lockRoutingCutover } from '@/lib/routing/cutover'

type Env = Record<string, string | undefined>
const MAX_SERIALIZABLE_ATTEMPTS = 3

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

  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
    await lockRoutingCutover(tx)
    await onRoutingLock?.()
    const now = new Date()
    const summary: BackfillSummary = {
      centralGroupsCreated: 0, channelsCreated: 0, policiesCreated: 0, appsChanged: 0, bridgeRetired: false,
    }
    const retired = await tx.select({ key: supportSettings.key }).from(supportSettings)
      .where(sql`${supportSettings.key} = ${LEGACY_PUSHOVER_BRIDGE_RETIRED_MARKER}`).for('update').limit(1)
    const bridgeWasAlreadyRetired = retired.length > 0
    const centralGroup = await centralFallbackGroup(tx, now, summary)
    const mustValidateCentralRoute = Boolean(pushover) || bridgeWasAlreadyRetired
    const routeKeyring = keyring ?? (bridgeWasAlreadyRetired ? loadChannelKeyring(env) : null)
    const channel = mustValidateCentralRoute
      ? await centralPushoverChannel(tx, centralGroup, pushover, routeKeyring, now, summary)
      : null
    const apps = await tx.select({ id: sourceApps.id, technicalGroupId: sourceApps.technicalGroupId, credentialMode: sourceApps.credentialMode })
      .from(sourceApps).for('update')

    for (const app of apps) {
      const policy = await tx.select({ id: appNotificationPolicies.id }).from(appNotificationPolicies)
        .where(sql`${appNotificationPolicies.sourceAppId} = ${app.id}`).limit(1)
      const changes: string[] = []
      if (!bridgeWasAlreadyRetired && app.technicalGroupId === null) changes.push('assignment')
      if (!bridgeWasAlreadyRetired && app.credentialMode !== 'LEGACY_BEARER') changes.push('mode')
      if (channel && !policy[0]) changes.push('policy')
      if (changes.includes('assignment') || changes.includes('mode')) {
        await tx.update(sourceApps).set({
          technicalGroupId: app.technicalGroupId ?? centralGroup.id,
          credentialMode: 'LEGACY_BEARER',
          updatedAt: now,
        })
          .where(sql`${sourceApps.id} = ${app.id}`)
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
      if (changes.length > 0) {
        summary.appsChanged += 1
        await appendAuditEvent({
          db: tx, actorId, correlationId: `routing-backfill:${actorId}:${app.id}`, reason: 'legacy routing cutover',
          action: 'SUPPORT_ROUTING_BACKFILLED', subjectType: 'source_app', subjectId: app.id,
          metadata: {
            changes,
            assignedCentralFallback: changes.includes('assignment'),
            credentialMode: changes.includes('mode') ? 'LEGACY_BEARER' : undefined,
            policyInstalled: changes.includes('policy'),
          }, now,
        })
      }
    }

    if (channel && !bridgeWasAlreadyRetired) {
      const marker = await tx.insert(supportSettings).values({ key: LEGACY_PUSHOVER_BRIDGE_RETIRED_MARKER, value: now.toISOString(), updatedAt: now })
        .onConflictDoNothing().returning({ key: supportSettings.key })
      summary.bridgeRetired = marker.length > 0
    }
    return summary
      }, { isolationLevel: 'serializable', accessMode: 'read write' })
    } catch (error) {
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS || !isRetryableTransactionError(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 10))
    }
  }
  throw new Error('Backfill retry exhausted')
}

function isRetryableTransactionError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (code === '40001' || code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

async function centralFallbackGroup(tx: DbTransaction, now: Date, summary: BackfillSummary): Promise<{ id: string; status: string }> {
  const existing = await tx.select({ id: supportGroups.id, status: supportGroups.status }).from(supportGroups)
    .where(sql`${supportGroups.isCentralFallback} = true`).for('update').limit(1)
  if (existing[0]) return existing[0]
  const id = nanoid()
  await tx.insert(supportGroups).values({ id, name: 'Central support', status: 'ACTIVE', isCentralFallback: true, createdAt: now, updatedAt: now })
  summary.centralGroupsCreated += 1
  return { id, status: 'ACTIVE' }
}

async function centralPushoverChannel(
  tx: DbTransaction,
  group: { id: string; status: string },
  config: { appToken: string; userKey: string } | null,
  keyring: ChannelKeyring | null,
  now: Date,
  summary: BackfillSummary,
): Promise<{ id: string }> {
  if (group.status !== 'ACTIVE') throw new Error('Central support group is not active')
  const existing = await tx.select({
    id: notificationChannels.id, type: notificationChannels.type, status: notificationChannels.status,
    encryptedConfig: notificationChannels.encryptedConfig, configNonce: notificationChannels.configNonce,
    configAuthTag: notificationChannels.configAuthTag, keyVersion: notificationChannels.keyVersion,
  }).from(notificationChannels)
    .where(sql`${notificationChannels.groupId} = ${group.id} and ${notificationChannels.name} = 'Central Pushover'`).for('update').limit(1)
  if (existing[0]) {
    if (existing[0].type !== 'PUSHOVER' || existing[0].status !== 'ACTIVE') {
      throw new Error('Central Pushover channel is not active and usable')
    }
    if (!keyring || !Number.isInteger(existing[0].keyVersion) || existing[0].keyVersion < 1 || existing[0].keyVersion > 2_147_483_647) {
      throw new Error('Central Pushover channel cannot be verified')
    }
    const decrypted = decryptChannelConfig({
      ciphertext: existing[0].encryptedConfig, nonce: existing[0].configNonce,
      authTag: existing[0].configAuthTag, keyVersion: `v${existing[0].keyVersion}`,
    }, { channelId: existing[0].id, type: 'PUSHOVER' }, keyring)
    if (decrypted.type !== 'PUSHOVER' || !decrypted.appToken.trim() || !decrypted.userKey.trim()) {
      throw new Error('Central Pushover channel is not usable')
    }
    return { id: existing[0].id }
  }
  if (!config || !keyring) throw new Error('Central Pushover channel is required for retired bridge')
  const id = nanoid()
  const encrypted = encryptChannelConfig({ type: 'PUSHOVER', ...config }, { channelId: id, type: 'PUSHOVER' }, keyring)
  await tx.insert(notificationChannels).values({
    id, groupId: group.id, name: 'Central Pushover', type: 'PUSHOVER', status: 'ACTIVE',
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
