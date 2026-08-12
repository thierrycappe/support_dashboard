import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent, type AuditMutationContext } from '@/lib/audit/events'
import { getDb, type Db } from '@/lib/db'
import { notificationChannels } from '@/lib/db/schema'
import type { ChannelConfig, DeliveryChannelType } from '@/lib/delivery/types'
import { validateChannelConfigForPersistence } from '@/lib/routing/channel-schemas'
import { encryptChannelConfig, loadChannelKeyring, type ChannelKeyring } from '@/lib/routing/crypto'

export interface PublicChannel {
  id: string
  groupId: string
  name: string
  type: 'EMAIL' | 'PUSHOVER' | 'WEBHOOK'
  status: 'ACTIVE' | 'DISABLED' | 'UNHEALTHY'
  destinationLabel: string
  includeReporterContext: boolean
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
}

type ChannelStatus = PublicChannel['status']

type ValidateConfig = (type: DeliveryChannelType, value: unknown) => Promise<ChannelConfig>

const publicChannelSelection = {
  id: notificationChannels.id,
  groupId: notificationChannels.groupId,
  name: notificationChannels.name,
  type: notificationChannels.type,
  status: notificationChannels.status,
  recipientDisplay: notificationChannels.recipientDisplay,
  redactedDestination: notificationChannels.redactedDestination,
  includeReporterContext: notificationChannels.includeReporterContext,
  lastSucceededAt: notificationChannels.lastSucceededAt,
  lastFailedAt: notificationChannels.lastFailedAt,
}
const channelRevision = sql<string>`xmin`

export async function createChannel({
  db = getDb(), keyring = loadChannelKeyring(), groupId, name, type, config,
  status = 'ACTIVE', includeReporterContext = false, validateConfig = validateChannelConfigForPersistence, ...audit
}: AuditMutationContext & {
  db?: Db
  keyring?: ChannelKeyring | null
  groupId: string
  name: string
  type: DeliveryChannelType
  config: unknown
  status?: ChannelStatus
  includeReporterContext?: boolean
  validateConfig?: ValidateConfig
}): Promise<PublicChannel> {
  const id = nanoid()
  const now = new Date()
  const safeConfig = await validateConfig(type, config)
  const encrypted = encrypt(safeConfig, id, keyring)
  const destinationLabel = redactedDestination(safeConfig)
  const record = {
    id, groupId, name: required(name, 'name'), type, status,
    encryptedConfig: encrypted.ciphertext, configNonce: encrypted.nonce,
    configAuthTag: encrypted.authTag, keyVersion: keyVersionNumber(encrypted.keyVersion),
    recipientDisplay: destinationLabel, redactedDestination: destinationLabel,
    includeReporterContext, createdAt: now, updatedAt: now,
  }
  await db.transaction(async (tx) => {
    await tx.insert(notificationChannels).values(record)
    await appendAuditEvent({
      db: tx, ...audit, action: 'CHANNEL_CREATED', subjectType: 'notification_channel', subjectId: id,
      metadata: { groupId, channelType: type, status, reporterContext: includeReporterContext }, now,
    })
  })
  return publicChannel({ ...record, lastSucceededAt: null, lastFailedAt: null })
}

export async function updateChannel({
  db = getDb(), keyring = loadChannelKeyring(), id, name, status, config,
  includeReporterContext, validateConfig = validateChannelConfigForPersistence, ...audit
}: AuditMutationContext & {
  db?: Db
  keyring?: ChannelKeyring | null
  id: string
  name?: string
  status?: ChannelStatus
  config?: unknown
  includeReporterContext?: boolean
  validateConfig?: ValidateConfig
}): Promise<PublicChannel> {
  const snapshotRows = await db.select({
    id: notificationChannels.id,
    type: notificationChannels.type,
    keyVersion: notificationChannels.keyVersion,
    revision: channelRevision,
  }).from(notificationChannels).where(eq(notificationChannels.id, id)).limit(1)
  const snapshot = snapshotRows[0]
  if (!snapshot) throw new Error('Notification channel not found')
  const safeConfig = config === undefined ? null : await validateConfig(snapshot.type, config)
  const encrypted = safeConfig ? encrypt(safeConfig, id, keyring) : null
  const destinationLabel = safeConfig ? redactedDestination(safeConfig) : null
  const now = new Date()
  return db.transaction(async (tx) => {
    const existing = await tx.select({
      ...publicChannelSelection,
      keyVersion: notificationChannels.keyVersion,
      revision: channelRevision,
    }).from(notificationChannels).where(eq(notificationChannels.id, id)).for('update').limit(1)
    const current = existing[0]
    if (!current) throw new Error('Notification channel not found')
    if (safeConfig && (
      current.type !== snapshot.type
      || current.keyVersion !== snapshot.keyVersion
      || current.revision !== snapshot.revision
    )) throw new Error('Channel changed during configuration validation')

    const changes: Record<string, unknown> = { updatedAt: now }
    const changed: string[] = []
    if (name !== undefined) { changes.name = required(name, 'name'); changed.push('name') }
    if (status !== undefined) { changes.status = status; changed.push('status') }
    if (includeReporterContext !== undefined) { changes.includeReporterContext = includeReporterContext; changed.push('reporterContext') }
    if (encrypted && destinationLabel) {
      Object.assign(changes, {
        encryptedConfig: encrypted.ciphertext, configNonce: encrypted.nonce,
        configAuthTag: encrypted.authTag, keyVersion: keyVersionNumber(encrypted.keyVersion),
        recipientDisplay: destinationLabel, redactedDestination: destinationLabel,
      })
      changed.push('configuration')
    }
    const rows = await tx.update(notificationChannels).set(changes).where(eq(notificationChannels.id, id)).returning(publicChannelSelection)
    const row = rows[0]
    if (!row) throw new Error('Notification channel not found')
    await appendAuditEvent({
      db: tx, ...audit, action: 'CHANNEL_UPDATED', subjectType: 'notification_channel', subjectId: id,
      metadata: { changed, channelType: row.type }, now,
    })
    return publicChannel(row)
  })
}

export function publicChannel(row: {
  id: string; groupId: string; name: string; type: DeliveryChannelType; status: string
  recipientDisplay: string | null; redactedDestination: string | null; includeReporterContext: boolean
  lastSucceededAt: Date | null; lastFailedAt: Date | null
}): PublicChannel {
  return {
    id: row.id, groupId: row.groupId, name: row.name, type: row.type,
    status: row.status as ChannelStatus,
    destinationLabel: row.recipientDisplay ?? row.redactedDestination ?? `${row.type} destination`,
    includeReporterContext: row.includeReporterContext,
    lastSuccessAt: row.lastSucceededAt, lastFailureAt: row.lastFailedAt,
  }
}

function encrypt(config: ChannelConfig, channelId: string, keyring: ChannelKeyring | null | undefined) {
  if (!keyring) throw new Error('Channel encryption keyring is not configured')
  return encryptChannelConfig(config, { channelId, type: config.type }, keyring)
}

function keyVersionNumber(version: string): number {
  return Number(version.slice(1))
}

function redactedDestination(config: ChannelConfig): string {
  if (config.type === 'EMAIL') return config.to.map(redactEmail).join(', ')
  if (config.type === 'PUSHOVER') return 'Pushover recipient'
  return `Webhook ${new URL(config.url).hostname}`
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@')
  return `${local?.slice(0, 1) ?? '*'}***@${domain ?? '***'}`
}

function required(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${name} is required`)
  return trimmed
}
