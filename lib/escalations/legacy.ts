import { eq, sql } from 'drizzle-orm'
import { getDb, type Db, type DbTransaction } from '@/lib/db'
import { appNotificationPolicies, sourceApps, supportSettings } from '@/lib/db/schema'
import { canonicalEscalationDigest, legacyPayloadToCommand } from '@/lib/escalations/contract'
import { acceptEscalation, type IntakeDependencies, type IntakeResult } from '@/lib/escalations/intake'
import { resolveTargetsFromDb } from '@/lib/escalations/repository'
import { feedbackIngestSchema, type FeedbackIngestPayload, type IngestResult } from '@/lib/feedback/ingest'

type Env = Record<string, string | undefined>

export async function acceptLegacyPayload({
  payload,
  authoritativeAppSlug,
  idempotencyKey,
  db = getDb(),
  env = process.env,
  scheduleDeliveryWakeup,
  resolveTargets,
}: {
  payload: FeedbackIngestPayload
  authoritativeAppSlug: string
  idempotencyKey?: string | null
  db?: Db
  env?: Env
  scheduleDeliveryWakeup?: () => void
  resolveTargets?: IntakeDependencies['resolveTargets']
}): Promise<IntakeResult> {
  const parsedPayload = feedbackIngestSchema.parse(payload)
  if (parsedPayload.app.slug !== authoritativeAppSlug) throw new Error('source app identity mismatch')
  const app = await db.select({ id: sourceApps.id }).from(sourceApps)
    .where(eq(sourceApps.slug, authoritativeAppSlug)).limit(1)
  if (!app[0]) throw new Error('configured source app is not registered')
  const normalized = legacyPayloadToCommand(parsedPayload, app[0].id)
  const key = idempotencyKey?.trim() || `legacy:${normalized.command.externalId}:${canonicalEscalationDigest(normalized.command)}`
  return acceptEscalation({ appId: normalized.authoritativeAppId, credentialId: null, idempotencyKey: key, command: normalized.command }, {
    db,
    scheduleDeliveryWakeup,
    resolveTargets: resolveTargets ?? ((tx, appId, priority) => resolveLegacyTargets(tx, appId, priority, env)),
  })
}

export function legacyResult(result: IntakeResult): IngestResult {
  return { appId: result.appId, ticketId: result.ticketId, created: result.result === 'created' }
}

async function resolveLegacyTargets(tx: DbTransaction, appId: string, priority: Parameters<typeof resolveTargetsFromDb>[2], env: Env) {
  // Target selection and the routing backfill share this transaction-scoped
  // lock. A material event therefore observes exactly one cutover state.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('support-tower-routing-cutover'))`)
  const retired = await tx.select({ key: supportSettings.key }).from(supportSettings)
    .where(eq(supportSettings.key, 'legacy_pushover_bridge_retired_at')).limit(1)
  const policies = await tx.select({ id: appNotificationPolicies.id }).from(appNotificationPolicies)
    .where(eq(appNotificationPolicies.sourceAppId, appId)).limit(1)
  const hasLegacyBridge = Boolean(env.PUSHOVER_APP_TOKEN?.trim() && env.PUSHOVER_USER_KEY?.trim())
  if (retired.length === 0 && policies.length === 0 && hasLegacyBridge) {
    return { targets: [{ targetKey: 'legacy:central-pushover', channelId: null, channelType: 'PUSHOVER' as const, configSource: 'LEGACY_ENV' as const, includeReporterContext: false }], incident: null }
  }
  return resolveTargetsFromDb(tx, appId, priority)
}
