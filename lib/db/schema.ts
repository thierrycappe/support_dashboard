import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const appStatus = pgEnum('AppStatus', ['ACTIVE', 'PAUSED'])

export const feedbackKind = pgEnum('FeedbackKind', ['BUG', 'EVOLUTION'])

export const feedbackPriority = pgEnum('FeedbackPriority', [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
])

export const feedbackStatus = pgEnum('FeedbackStatus', [
  'NEW',
  'IN_REVIEW',
  'BACKLOG',
  'PLANNED',
  'IN_PROGRESS',
  'FIXED',
  'SHIPPED',
  'DECLINED',
  'CLOSED',
])

export const notificationKind = pgEnum('NotificationKind', [
  'STATUS_CHANGE',
  'ADMIN_REPLY',
  'COMBINED',
  'SYNC_ERROR',
])

export const authUserRole = pgEnum('AuthUserRole', ['ADMIN', 'SUPPORT'])

export const authUserStatus = pgEnum('AuthUserStatus', ['ACTIVE', 'DISABLED'])

export const sourceApps = pgTable(
  'source_apps',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url'),
    environment: text('environment').notNull().default('production'),
    status: appStatus('status').notNull().default('ACTIVE'),
    lastSeenAt: timestamp('last_seen_at', { precision: 3 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('source_apps_slug_idx').on(table.slug),
    index('source_apps_status_idx').on(table.status),
  ],
)

export const feedbackTickets = pgTable(
  'feedback_tickets',
  {
    id: text('id').primaryKey(),
    sourceAppId: text('source_app_id')
      .notNull()
      .references(() => sourceApps.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    externalId: text('external_id').notNull(),
    kind: feedbackKind('kind').notNull(),
    status: feedbackStatus('status').notNull().default('NEW'),
    priority: feedbackPriority('priority').notNull().default('MEDIUM'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    reporterName: text('reporter_name'),
    reporterEmail: text('reporter_email'),
    reporterId: text('reporter_id'),
    url: text('url'),
    browserInfo: text('browser_info'),
    markdownSpec: text('markdown_spec'),
    transcript: jsonb('transcript').$type<Array<{ role: string; content: string }>>(),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
    remoteCreatedAt: timestamp('remote_created_at', { precision: 3 }),
    remoteUpdatedAt: timestamp('remote_updated_at', { precision: 3 }),
    lastStatusChangeAt: timestamp('last_status_change_at', { precision: 3 }),
    lastSyncedAt: timestamp('last_synced_at', { precision: 3 }).notNull(),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('feedback_tickets_source_external_idx').on(
      table.sourceAppId,
      table.externalId,
    ),
    index('feedback_tickets_status_idx').on(table.status),
    index('feedback_tickets_kind_idx').on(table.kind),
    index('feedback_tickets_priority_idx').on(table.priority),
    index('feedback_tickets_app_status_idx').on(table.sourceAppId, table.status),
  ],
)

export const feedbackReplies = pgTable(
  'feedback_replies',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id')
      .notNull()
      .references(() => feedbackTickets.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    authorName: text('author_name').notNull(),
    authorEmail: text('author_email'),
    body: text('body').notNull(),
    isSyncedBack: boolean('is_synced_back').notNull().default(false),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
  },
  (table) => [
    index('feedback_replies_feedback_id_idx').on(table.feedbackId, table.createdAt),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    feedbackId: text('feedback_id').references(() => feedbackTickets.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    kind: notificationKind('kind').notNull(),
    body: text('body').notNull(),
    link: text('link').notNull(),
    readAt: timestamp('read_at', { precision: 3 }),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
  },
  (table) => [
    index('notifications_unread_idx')
      .on(table.readAt)
      .where(sql`${table.readAt} IS NULL`),
    index('notifications_created_idx').on(table.createdAt),
  ],
)

export const authLoginAttempts = pgTable(
  'auth_login_attempts',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    success: boolean('success').notNull().default(false),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
  },
  (table) => [
    index('auth_login_attempts_identifier_created_idx').on(
      table.identifier,
      table.createdAt,
    ),
    index('auth_login_attempts_ip_created_idx').on(table.ipAddress, table.createdAt),
  ],
)

export const supportUsers = pgTable(
  'support_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: authUserRole('role').notNull().default('SUPPORT'),
    status: authUserStatus('status').notNull().default('ACTIVE'),
    passwordHash: text('password_hash').notNull(),
    lastLoginAt: timestamp('last_login_at', { precision: 3 }),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('support_users_email_idx').on(table.email),
    index('support_users_role_idx').on(table.role),
    index('support_users_status_idx').on(table.status),
  ],
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => supportUsers.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    tokenHash: text('token_hash').notNull(),
    requestedIp: text('requested_ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { precision: 3 }).notNull(),
    usedAt: timestamp('used_at', { precision: 3 }),
    createdAt: timestamp('created_at', { precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_hash_idx').on(table.tokenHash),
    index('password_reset_tokens_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    index('password_reset_tokens_expires_idx').on(table.expiresAt),
  ],
)
