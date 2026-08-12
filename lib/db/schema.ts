import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const appStatus = pgEnum('AppStatus', ['ACTIVE', 'PAUSED'])
export const feedbackKind = pgEnum('FeedbackKind', ['BUG', 'EVOLUTION'])
export const feedbackPriority = pgEnum('FeedbackPriority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
export const feedbackStatus = pgEnum('FeedbackStatus', [
  'NEW', 'IN_REVIEW', 'BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FIXED', 'SHIPPED', 'DECLINED', 'CLOSED',
])
export const notificationKind = pgEnum('NotificationKind', ['STATUS_CHANGE', 'ADMIN_REPLY', 'COMBINED', 'SYNC_ERROR'])
export const authUserRole = pgEnum('AuthUserRole', ['ADMIN', 'SUPPORT'])
export const authUserStatus = pgEnum('AuthUserStatus', ['ACTIVE', 'DISABLED'])
export const enrollmentStatus = pgEnum('EnrollmentStatus', ['PENDING', 'ACTIVE', 'PAUSED', 'REVOKED'])
export const credentialMode = pgEnum('CredentialMode', ['LEGACY_BEARER', 'PUBLIC_KEY'])
export const credentialStatus = pgEnum('CredentialStatus', ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED'])
export const channelType = pgEnum('ChannelType', ['EMAIL', 'PUSHOVER', 'WEBHOOK'])
export const channelStatus = pgEnum('ChannelStatus', ['ACTIVE', 'DISABLED', 'UNHEALTHY'])
export const deliveryStatus = pgEnum('DeliveryStatus', ['PENDING', 'LEASED', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED'])

export interface FeedbackTriage {
  ownerRef: string
  ownerName: string | null
  escalatedAt: string
}

const utcTimestamp = (name: string) =>
  timestamp(name, { precision: 3, withTimezone: true })

export const supportUsers = pgTable(
  'support_users',
  {
    id: text('id').primaryKey(), email: text('email').notNull(), name: text('name').notNull(),
    role: authUserRole('role').notNull().default('SUPPORT'), status: authUserStatus('status').notNull().default('ACTIVE'),
    passwordHash: text('password_hash').notNull(), lastLoginAt: timestamp('last_login_at', { precision: 3 }),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(), updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [uniqueIndex('support_users_email_idx').on(table.email), index('support_users_role_idx').on(table.role), index('support_users_status_idx').on(table.status)],
)

export const supportGroups = pgTable(
  'support_groups',
  {
    id: text('id').primaryKey(), name: text('name').notNull(), status: text('status').notNull().default('ACTIVE'),
    isCentralFallback: boolean('is_central_fallback').notNull().default(false),
    createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
  },
  (table) => [uniqueIndex('support_groups_name_idx').on(table.name), uniqueIndex('support_groups_one_central_fallback_idx').on(table.isCentralFallback).where(sql`${table.isCentralFallback}`)],
)

export const sourceApps = pgTable(
  'source_apps',
  {
    id: text('id').primaryKey(), slug: text('slug').notNull(), name: text('name').notNull(), baseUrl: text('base_url'),
    environment: text('environment').notNull().default('production'), status: appStatus('status').notNull().default('ACTIVE'),
    enrollmentStatus: enrollmentStatus('enrollment_status').notNull().default('PENDING'), credentialMode: credentialMode('credential_mode').notNull().default('LEGACY_BEARER'),
    technicalGroupId: text('technical_group_id').references(() => supportGroups.id, { onUpdate: 'cascade', onDelete: 'set null' }),
    lastSeenAt: timestamp('last_seen_at', { precision: 3 }), lastAuthenticatedAt: utcTimestamp('last_authenticated_at'), lastIngestedAt: utcTimestamp('last_ingested_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(), createdAt: timestamp('created_at', { precision: 3 }).notNull(), updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [uniqueIndex('source_apps_slug_idx').on(table.slug), index('source_apps_status_idx').on(table.status), index('source_apps_group_idx').on(table.technicalGroupId), index('source_apps_last_ingested_idx').on(table.id, table.lastIngestedAt)],
)

export const feedbackTickets = pgTable(
  'feedback_tickets',
  {
    id: text('id').primaryKey(), sourceAppId: text('source_app_id').notNull().references(() => sourceApps.id, { onUpdate: 'cascade', onDelete: 'cascade' }), externalId: text('external_id').notNull(),
    kind: feedbackKind('kind').notNull(), status: feedbackStatus('status').notNull().default('NEW'), priority: feedbackPriority('priority').notNull().default('MEDIUM'),
    title: text('title').notNull(), description: text('description').notNull(), reporterName: text('reporter_name'), reporterEmail: text('reporter_email'), reporterId: text('reporter_id'), url: text('url'), browserInfo: text('browser_info'), markdownSpec: text('markdown_spec'),
    transcript: jsonb('transcript').$type<Array<{ role: string; content: string }>>(), rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(), triage: jsonb('triage').$type<FeedbackTriage>(),
    remoteCreatedAt: timestamp('remote_created_at', { precision: 3 }), remoteUpdatedAt: timestamp('remote_updated_at', { precision: 3 }), lastStatusChangeAt: timestamp('last_status_change_at', { precision: 3 }), lastSyncedAt: timestamp('last_synced_at', { precision: 3 }).notNull(),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(), updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [uniqueIndex('feedback_tickets_source_external_idx').on(table.sourceAppId, table.externalId), index('feedback_tickets_status_idx').on(table.status), index('feedback_tickets_kind_idx').on(table.kind), index('feedback_tickets_priority_idx').on(table.priority), index('feedback_tickets_app_status_idx').on(table.sourceAppId, table.status), index('feedback_tickets_open_queue_idx').on(table.status, table.priority, table.updatedAt, table.id)],
)

export const feedbackReplies = pgTable('feedback_replies', {
  id: text('id').primaryKey(), feedbackId: text('feedback_id').notNull().references(() => feedbackTickets.id, { onUpdate: 'cascade', onDelete: 'cascade' }), authorName: text('author_name').notNull(), authorEmail: text('author_email'), body: text('body').notNull(), isSyncedBack: boolean('is_synced_back').notNull().default(false), createdAt: timestamp('created_at', { precision: 3 }).notNull(),
}, (table) => [index('feedback_replies_feedback_id_idx').on(table.feedbackId, table.createdAt)])

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(), feedbackId: text('feedback_id').references(() => feedbackTickets.id, { onUpdate: 'cascade', onDelete: 'cascade' }), kind: notificationKind('kind').notNull(), body: text('body').notNull(), link: text('link').notNull(), readAt: timestamp('read_at', { precision: 3 }), createdAt: timestamp('created_at', { precision: 3 }).notNull(),
}, (table) => [index('notifications_unread_idx').on(table.readAt).where(sql`${table.readAt} IS NULL`), index('notifications_created_idx').on(table.createdAt)])

export const authLoginAttempts = pgTable('auth_login_attempts', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), ipAddress: text('ip_address'), userAgent: text('user_agent'), success: boolean('success').notNull().default(false), createdAt: timestamp('created_at', { precision: 3 }).notNull(),
}, (table) => [index('auth_login_attempts_identifier_created_idx').on(table.identifier, table.createdAt), index('auth_login_attempts_ip_created_idx').on(table.ipAddress, table.createdAt)])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => supportUsers.id, { onUpdate: 'cascade', onDelete: 'cascade' }), tokenHash: text('token_hash').notNull(), requestedIp: text('requested_ip'), userAgent: text('user_agent'), expiresAt: timestamp('expires_at', { precision: 3 }).notNull(), usedAt: timestamp('used_at', { precision: 3 }), createdAt: timestamp('created_at', { precision: 3 }).notNull(),
}, (table) => [uniqueIndex('password_reset_tokens_hash_idx').on(table.tokenHash), index('password_reset_tokens_user_created_idx').on(table.userId, table.createdAt), index('password_reset_tokens_expires_idx').on(table.expiresAt)])

export const appEnrollmentGrants = pgTable('app_enrollment_grants', {
  id: text('id').primaryKey(), sourceAppId: text('source_app_id').notNull().references(() => sourceApps.id, { onUpdate: 'cascade', onDelete: 'cascade' }), tokenDigest: text('token_digest').notNull(), tokenPrefix: text('token_prefix').notNull(), expiresAt: utcTimestamp('expires_at').notNull(), consumedAt: utcTimestamp('consumed_at'), revokedAt: utcTimestamp('revoked_at'), createdByUserId: text('created_by_user_id').references(() => supportUsers.id, { onUpdate: 'cascade', onDelete: 'set null' }), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [uniqueIndex('app_enrollment_grants_token_digest_idx').on(table.tokenDigest), index('app_enrollment_grants_app_idx').on(table.sourceAppId)])

export const appCredentials = pgTable('app_credentials', {
  id: text('id').primaryKey(), sourceAppId: text('source_app_id').notNull().references(() => sourceApps.id, { onUpdate: 'cascade', onDelete: 'cascade' }), publicJwk: jsonb('public_jwk').$type<Record<string, unknown>>().notNull(), publicKeyThumbprint: text('public_key_thumbprint').notNull(), status: credentialStatus('status').notNull().default('PENDING'), validFrom: utcTimestamp('valid_from').notNull(), validUntil: utcTimestamp('valid_until'), revokedAt: utcTimestamp('revoked_at'), revokedByUserId: text('revoked_by_user_id').references(() => supportUsers.id, { onUpdate: 'cascade', onDelete: 'set null' }), rotationParentId: text('rotation_parent_id'), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [
  uniqueIndex('app_credentials_thumbprint_idx').on(table.publicKeyThumbprint),
  index('app_credentials_app_status_idx').on(table.sourceAppId, table.status),
  foreignKey({
    name: 'app_credentials_rotation_parent_id_app_credentials_id_fk',
    columns: [table.rotationParentId],
    foreignColumns: [table.id],
  }).onUpdate('cascade').onDelete('set null'),
])

export const serviceAssertionReplays = pgTable('service_assertion_replays', {
  id: text('id').primaryKey(), credentialId: text('credential_id').notNull().references(() => appCredentials.id, { onUpdate: 'cascade', onDelete: 'cascade' }), assertionJti: text('assertion_jti').notNull(), expiresAt: utcTimestamp('expires_at').notNull(), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [uniqueIndex('service_assertion_replays_credential_jti_idx').on(table.credentialId, table.assertionJti), index('service_assertion_replays_expires_idx').on(table.expiresAt)])

export const ingestReceipts = pgTable('ingest_receipts', {
  id: text('id').primaryKey(), sourceAppId: text('source_app_id').notNull().references(() => sourceApps.id, { onUpdate: 'cascade', onDelete: 'cascade' }), idempotencyKey: text('idempotency_key').notNull(), canonicalDigest: text('canonical_digest').notNull(), ticketId: text('ticket_id').references(() => feedbackTickets.id, { onUpdate: 'cascade', onDelete: 'set null' }), result: text('result').notNull(), responseSnapshot: jsonb('response_snapshot').$type<Record<string, unknown>>().notNull(), createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
}, (table) => [uniqueIndex('ingest_receipts_app_idempotency_idx').on(table.sourceAppId, table.idempotencyKey), index('ingest_receipts_ticket_idx').on(table.ticketId)])

export const escalationEvents = pgTable('escalation_events', {
  id: text('id').primaryKey(), ticketId: text('ticket_id').notNull().references(() => feedbackTickets.id, { onUpdate: 'cascade', onDelete: 'cascade' }), generation: integer('generation').notNull(), eventKey: text('event_key').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [uniqueIndex('escalation_events_ticket_generation_idx').on(table.ticketId, table.generation), uniqueIndex('escalation_events_event_key_idx').on(table.eventKey), index('escalation_events_ticket_created_idx').on(table.ticketId, table.createdAt)])

export const routingIncidents = pgTable('routing_incidents', {
  id: text('id').primaryKey(), escalationEventId: text('escalation_event_id').notNull().references(() => escalationEvents.id, { onUpdate: 'cascade', onDelete: 'cascade' }), reason: text('reason').notNull(), details: jsonb('details').$type<Record<string, unknown>>(), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [uniqueIndex('routing_incidents_event_idx').on(table.escalationEventId)])

export const supportGroupMembers = pgTable('support_group_members', {
  id: text('id').primaryKey(), groupId: text('group_id').notNull().references(() => supportGroups.id, { onUpdate: 'cascade', onDelete: 'cascade' }), supportUserId: text('support_user_id').references(() => supportUsers.id, { onUpdate: 'cascade', onDelete: 'set null' }), recipientRef: text('recipient_ref'), role: text('role').notNull().default('MEMBER'), status: text('status').notNull().default('ACTIVE'), createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
}, (table) => [uniqueIndex('support_group_members_group_user_idx').on(table.groupId, table.supportUserId), index('support_group_members_group_idx').on(table.groupId)])

export const notificationChannels = pgTable('notification_channels', {
  id: text('id').primaryKey(), groupId: text('group_id').notNull().references(() => supportGroups.id, { onUpdate: 'cascade', onDelete: 'cascade' }), name: text('name').notNull(), type: channelType('type').notNull(), status: channelStatus('status').notNull().default('ACTIVE'), encryptedConfig: text('encrypted_config').notNull(), configNonce: text('config_nonce').notNull(), configAuthTag: text('config_auth_tag').notNull(), keyVersion: integer('key_version').notNull(), recipientDisplay: text('recipient_display'), redactedDestination: text('redacted_destination'), lastSucceededAt: utcTimestamp('last_succeeded_at'), lastFailedAt: utcTimestamp('last_failed_at'), createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
}, (table) => [uniqueIndex('notification_channels_group_name_idx').on(table.groupId, table.name), index('notification_channels_group_status_idx').on(table.groupId, table.status)])

export const appNotificationPolicies = pgTable('app_notification_policies', {
  id: text('id').primaryKey(), sourceAppId: text('source_app_id').notNull().references(() => sourceApps.id, { onUpdate: 'cascade', onDelete: 'cascade' }), minimumPriority: feedbackPriority('minimum_priority').notNull().default('MEDIUM'), urgentCentralCopy: boolean('urgent_central_copy').notNull().default(true), fallbackToCentral: boolean('fallback_to_central').notNull().default(true), createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
}, (table) => [uniqueIndex('app_notification_policies_app_idx').on(table.sourceAppId)])

export const deliveryOutbox = pgTable('delivery_outbox', {
  id: text('id').primaryKey(), escalationEventId: text('escalation_event_id').notNull().references(() => escalationEvents.id, { onUpdate: 'cascade', onDelete: 'cascade' }), eventKey: text('event_key').notNull(), targetKey: text('target_key').notNull(), generation: integer('generation').notNull(), channelId: text('channel_id').references(() => notificationChannels.id, { onUpdate: 'cascade', onDelete: 'set null' }), channelType: channelType('channel_type').notNull(), configSource: text('config_source').notNull(), renderedPayload: jsonb('rendered_payload').$type<Record<string, unknown>>().notNull(), status: deliveryStatus('status').notNull().default('PENDING'), nextAttemptAt: utcTimestamp('next_attempt_at').notNull(), attemptCount: integer('attempt_count').notNull().default(0), leaseToken: text('lease_token'), leaseExpiresAt: utcTimestamp('lease_expires_at'), sentAt: utcTimestamp('sent_at'), createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
}, (table) => [
  uniqueIndex('delivery_outbox_event_target_generation_idx').on(table.eventKey, table.targetKey, table.generation),
  index('delivery_outbox_claim_idx').on(table.status, table.nextAttemptAt, table.leaseExpiresAt),
  index('delivery_outbox_channel_created_idx').on(table.channelId, table.createdAt),
  check('delivery_outbox_target_source_check', sql`(
    (${table.configSource} = 'DATABASE' and ${table.channelId} is not null and ${table.targetKey} = 'channel:' || ${table.channelId})
    or (${table.configSource} = 'LEGACY_ENV' and ${table.channelId} is null and ${table.targetKey} = 'legacy:central-pushover' and ${table.channelType} = 'PUSHOVER')
  )`),
])

export const deliveryAttempts = pgTable('delivery_attempts', {
  id: text('id').primaryKey(), outboxId: text('outbox_id').references(() => deliveryOutbox.id, { onUpdate: 'cascade', onDelete: 'set null' }), ordinal: integer('ordinal').notNull(), targetKey: text('target_key').notNull(), startedAt: utcTimestamp('started_at').notNull(), finishedAt: utcTimestamp('finished_at'), resultClass: text('result_class').notNull(), providerStatus: text('provider_status'), sanitizedError: text('sanitized_error'), providerMessageId: text('provider_message_id'), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [uniqueIndex('delivery_attempts_outbox_ordinal_idx').on(table.outboxId, table.ordinal), index('delivery_attempts_target_created_idx').on(table.targetKey, table.createdAt)])

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(), actorType: text('actor_type').notNull(), actorId: text('actor_id'), action: text('action').notNull(), subjectType: text('subject_type').notNull(), subjectId: text('subject_id'), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), requestCorrelationId: text('request_correlation_id'), createdAt: utcTimestamp('created_at').notNull(),
}, (table) => [index('audit_events_subject_created_idx').on(table.subjectType, table.subjectId, table.createdAt), index('audit_events_created_idx').on(table.createdAt)])

export const serviceRateLimitBuckets = pgTable('service_rate_limit_buckets', {
  id: text('id').primaryKey(), scope: text('scope').notNull(), subject: text('subject').notNull(), windowStart: utcTimestamp('window_start').notNull(), count: integer('count').notNull().default(0), createdAt: utcTimestamp('created_at').notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
}, (table) => [uniqueIndex('service_rate_limit_buckets_scope_subject_window_idx').on(table.scope, table.subject, table.windowStart)])

export const supportSettings = pgTable('support_settings', {
  key: text('key').primaryKey(), value: jsonb('value').$type<Record<string, unknown> | string | number | boolean | null>().notNull(), updatedAt: utcTimestamp('updated_at').notNull(),
})
