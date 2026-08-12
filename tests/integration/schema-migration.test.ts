import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { closeDbPool, getDbPool } from '@/lib/db'
import { applyMigration } from '@/lib/db/migrations'
import * as schema from '@/lib/db/schema'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

type TimestampColumn = {
  name: string
  getSQLType(): string
  config: { notNull: boolean; withTimezone: boolean; precision?: number }
}

const fixtureTable = `migration_fixture_${process.pid}`
const fixture = {
  name: `integration_fixture_${process.pid}`,
  sqlText: `create table if not exists ${fixtureTable} (id text primary key);`,
  pool: getDbPool(),
}
const rehearsalSchema = `schema_migration_${randomUUID().replaceAll('-', '')}`
let rehearsalPool: Pool
let supportMigrationSql: string

beforeAll(async () => {
  supportMigrationSql = await readFile(
    new URL('../../drizzle/0001_support_portal_core.sql', import.meta.url),
    'utf8',
  )
  await fixture.pool.query(`drop table if exists ${fixtureTable}`)
  await fixture.pool.query(`create table if not exists support_schema_migrations (
    name text primary key, checksum text not null,
    applied_at timestamptz not null default now()
  )`)
  await fixture.pool.query('delete from support_schema_migrations where name = $1', [fixture.name])
  await fixture.pool.query(`create schema ${rehearsalSchema}`)
  rehearsalPool = new Pool({
    connectionString: requireTestDatabaseUrl(),
    options: `-c search_path=${rehearsalSchema}`,
  })
  await createExactCurrentSchema(rehearsalPool)
})

afterAll(async () => {
  await rehearsalPool?.end()
  await fixture.pool.query(`drop table if exists ${fixtureTable}`)
  await fixture.pool.query('delete from support_schema_migrations where name = $1', [fixture.name])
  await fixture.pool.query(`drop schema if exists ${rehearsalSchema} cascade`)
  await closeDbPool()
})

it('applies the support portal migration exactly once', async () => {
  expect(await applyMigration(fixture)).toBe('applied')
  expect(await applyMigration(fixture)).toBe('already-applied')
})

it('rejects changed SQL under an applied migration name', async () => {
  await applyMigration(fixture)
  await expect(
    applyMigration({ ...fixture, sqlText: `${fixture.sqlText}\nselect 1;` }),
  ).rejects.toThrow('Migration checksum mismatch')
})

it('upgrades the exact current schema without changing legacy rows or named objects', async () => {
  const migration = migrationFixture()
  expect(await applyMigration(migration)).toBe('applied')
  expect(await applyMigration(migration)).toBe('already-applied')

  const legacyRows = await rehearsalPool.query<{ table_name: string; count: number }>(`
    select 'source_apps' as table_name, count(*)::int as count from source_apps union all
    select 'support_users', count(*)::int from support_users union all
    select 'feedback_tickets', count(*)::int from feedback_tickets union all
    select 'feedback_replies', count(*)::int from feedback_replies union all
    select 'notifications', count(*)::int from notifications union all
    select 'auth_login_attempts', count(*)::int from auth_login_attempts union all
    select 'password_reset_tokens', count(*)::int from password_reset_tokens
    order by table_name
  `)
  expect(legacyRows.rows).toEqual([
    { table_name: 'auth_login_attempts', count: 1 },
    { table_name: 'feedback_replies', count: 1 },
    { table_name: 'feedback_tickets', count: 1 },
    { table_name: 'notifications', count: 1 },
    { table_name: 'password_reset_tokens', count: 1 },
    { table_name: 'source_apps', count: 1 },
    { table_name: 'support_users', count: 1 },
  ])

  const preservedTicket = await rehearsalPool.query<{ title: string; triage: unknown }>(
    "select title, triage from feedback_tickets where id = 'legacy-ticket'",
  )
  expect(preservedTicket.rows).toEqual([{ title: 'Legacy ticket', triage: null }])

  const enums = await rehearsalPool.query<{ type_name: string; enumlabel: string }>(`
    select typ.typname as type_name, enum.enumlabel
      from pg_type typ join pg_enum enum on enum.enumtypid = typ.oid
     where typ.typname in (
       'AppStatus', 'FeedbackKind', 'FeedbackPriority', 'FeedbackStatus', 'NotificationKind',
       'AuthUserRole', 'AuthUserStatus', 'EnrollmentStatus', 'CredentialMode',
       'CredentialStatus', 'ChannelType', 'ChannelStatus', 'DeliveryStatus'
     ) order by typ.typname, enum.enumsortorder
  `)
  expect(enums.rows).toEqual([
    ['AppStatus', 'ACTIVE'], ['AppStatus', 'PAUSED'],
    ['AuthUserRole', 'ADMIN'], ['AuthUserRole', 'SUPPORT'],
    ['AuthUserStatus', 'ACTIVE'], ['AuthUserStatus', 'DISABLED'],
    ['ChannelStatus', 'ACTIVE'], ['ChannelStatus', 'DISABLED'], ['ChannelStatus', 'UNHEALTHY'],
    ['ChannelType', 'EMAIL'], ['ChannelType', 'PUSHOVER'], ['ChannelType', 'WEBHOOK'],
    ['CredentialMode', 'LEGACY_BEARER'], ['CredentialMode', 'PUBLIC_KEY'],
    ['CredentialStatus', 'PENDING'], ['CredentialStatus', 'ACTIVE'], ['CredentialStatus', 'EXPIRED'], ['CredentialStatus', 'REVOKED'],
    ['DeliveryStatus', 'PENDING'], ['DeliveryStatus', 'LEASED'], ['DeliveryStatus', 'RETRYING'], ['DeliveryStatus', 'SENT'], ['DeliveryStatus', 'FAILED'], ['DeliveryStatus', 'CANCELLED'],
    ['EnrollmentStatus', 'PENDING'], ['EnrollmentStatus', 'ACTIVE'], ['EnrollmentStatus', 'PAUSED'], ['EnrollmentStatus', 'REVOKED'],
    ['FeedbackKind', 'BUG'], ['FeedbackKind', 'EVOLUTION'],
    ['FeedbackPriority', 'LOW'], ['FeedbackPriority', 'MEDIUM'], ['FeedbackPriority', 'HIGH'], ['FeedbackPriority', 'URGENT'],
    ['FeedbackStatus', 'NEW'], ['FeedbackStatus', 'IN_REVIEW'], ['FeedbackStatus', 'BACKLOG'], ['FeedbackStatus', 'PLANNED'], ['FeedbackStatus', 'IN_PROGRESS'], ['FeedbackStatus', 'FIXED'], ['FeedbackStatus', 'SHIPPED'], ['FeedbackStatus', 'DECLINED'], ['FeedbackStatus', 'CLOSED'],
    ['NotificationKind', 'STATUS_CHANGE'], ['NotificationKind', 'ADMIN_REPLY'], ['NotificationKind', 'COMBINED'], ['NotificationKind', 'SYNC_ERROR'],
  ].map(([type_name, enumlabel]) => ({ type_name, enumlabel })))

  await expectNamedIndexes([
    'source_apps_slug_idx', 'source_apps_status_idx', 'feedback_tickets_source_external_idx',
    'feedback_tickets_status_idx', 'feedback_tickets_kind_idx', 'feedback_tickets_priority_idx',
    'feedback_tickets_app_status_idx', 'feedback_replies_feedback_id_idx', 'notifications_unread_idx',
    'notifications_created_idx', 'auth_login_attempts_identifier_created_idx',
    'auth_login_attempts_ip_created_idx', 'support_users_email_idx', 'support_users_role_idx',
    'support_users_status_idx', 'password_reset_tokens_hash_idx',
    'password_reset_tokens_user_created_idx', 'password_reset_tokens_expires_idx',
    'app_credentials_thumbprint_idx', 'app_credentials_app_status_idx', 'delivery_outbox_claim_idx',
    'delivery_outbox_event_target_generation_idx', 'escalation_events_ticket_generation_idx',
    'service_assertion_replays_expires_idx', 'support_groups_one_central_fallback_idx',
  ])
})

it('keeps Drizzle and migration column contracts aligned, including UTC timestamps', async () => {
  await applyMigration(migrationFixture())

  const timestamps: Array<{ table: string; column: TimestampColumn }> = [
    ['support_groups', schema.supportGroups.createdAt], ['support_groups', schema.supportGroups.updatedAt],
    ['source_apps', schema.sourceApps.lastAuthenticatedAt], ['source_apps', schema.sourceApps.lastIngestedAt],
    ['app_enrollment_grants', schema.appEnrollmentGrants.expiresAt], ['app_enrollment_grants', schema.appEnrollmentGrants.consumedAt], ['app_enrollment_grants', schema.appEnrollmentGrants.revokedAt], ['app_enrollment_grants', schema.appEnrollmentGrants.createdAt],
    ['app_credentials', schema.appCredentials.validFrom], ['app_credentials', schema.appCredentials.validUntil], ['app_credentials', schema.appCredentials.revokedAt], ['app_credentials', schema.appCredentials.createdAt],
    ['service_assertion_replays', schema.serviceAssertionReplays.expiresAt], ['service_assertion_replays', schema.serviceAssertionReplays.createdAt],
    ['ingest_receipts', schema.ingestReceipts.createdAt], ['ingest_receipts', schema.ingestReceipts.updatedAt],
    ['escalation_events', schema.escalationEvents.createdAt], ['routing_incidents', schema.routingIncidents.createdAt],
    ['support_group_members', schema.supportGroupMembers.createdAt], ['support_group_members', schema.supportGroupMembers.updatedAt],
    ['notification_channels', schema.notificationChannels.lastSucceededAt], ['notification_channels', schema.notificationChannels.lastFailedAt], ['notification_channels', schema.notificationChannels.createdAt], ['notification_channels', schema.notificationChannels.updatedAt],
    ['app_notification_policies', schema.appNotificationPolicies.createdAt], ['app_notification_policies', schema.appNotificationPolicies.updatedAt],
    ['delivery_outbox', schema.deliveryOutbox.nextAttemptAt], ['delivery_outbox', schema.deliveryOutbox.leaseExpiresAt], ['delivery_outbox', schema.deliveryOutbox.sentAt], ['delivery_outbox', schema.deliveryOutbox.createdAt], ['delivery_outbox', schema.deliveryOutbox.updatedAt],
    ['delivery_attempts', schema.deliveryAttempts.startedAt], ['delivery_attempts', schema.deliveryAttempts.finishedAt], ['delivery_attempts', schema.deliveryAttempts.createdAt],
    ['audit_events', schema.auditEvents.createdAt], ['service_rate_limit_buckets', schema.serviceRateLimitBuckets.windowStart], ['service_rate_limit_buckets', schema.serviceRateLimitBuckets.createdAt], ['service_rate_limit_buckets', schema.serviceRateLimitBuckets.updatedAt], ['support_settings', schema.supportSettings.updatedAt],
  ].map(([table, column]) => ({ table: table as string, column: column as unknown as TimestampColumn }))

  expect(timestamps.every(({ column }) => column.config.withTimezone && column.config.precision === 3 && column.getSQLType() === 'timestamp (3) with time zone')).toBe(true)

  const actualTimestamps = await rehearsalPool.query<{ table_name: string; column_name: string; is_nullable: string; data_type: string; datetime_precision: number }>(
    `select table_name, column_name, is_nullable, data_type, datetime_precision
       from information_schema.columns
      where table_schema = current_schema()
        and concat(table_name, '.', column_name) = any($1::text[])
      order by table_name, column_name`,
    [timestamps.map(({ table, column }) => `${table}.${column.name}`)],
  )
  expect(actualTimestamps.rows).toEqual(
    timestamps.map(({ table, column }) => ({
      table_name: table, column_name: column.name,
      is_nullable: column.config.notNull ? 'NO' : 'YES',
      data_type: 'timestamp with time zone', datetime_precision: 3,
    })).sort((left, right) => `${left.table_name}.${left.column_name}`.localeCompare(`${right.table_name}.${right.column_name}`)),
  )

  const columnContracts = await rehearsalPool.query<{ table_name: string; column_name: string; is_nullable: string; data_type: string; udt_name: string; has_default: boolean }>(`
    select table_name, column_name, is_nullable, data_type, udt_name, column_default is not null as has_default
      from information_schema.columns
     where table_schema = current_schema()
       and (table_name, column_name) in (
         ('source_apps', 'enrollment_status'), ('source_apps', 'credential_mode'),
         ('source_apps', 'technical_group_id'), ('feedback_tickets', 'triage'),
         ('delivery_outbox', 'channel_id'), ('delivery_outbox', 'target_key'),
         ('delivery_outbox', 'status'), ('support_settings', 'key')
       ) order by table_name, column_name
  `)
  expect(columnContracts.rows).toEqual([
    { table_name: 'delivery_outbox', column_name: 'channel_id', is_nullable: 'YES', data_type: 'text', udt_name: 'text', has_default: false },
    { table_name: 'delivery_outbox', column_name: 'status', is_nullable: 'NO', data_type: 'USER-DEFINED', udt_name: 'DeliveryStatus', has_default: true },
    { table_name: 'delivery_outbox', column_name: 'target_key', is_nullable: 'NO', data_type: 'text', udt_name: 'text', has_default: false },
    { table_name: 'feedback_tickets', column_name: 'triage', is_nullable: 'YES', data_type: 'jsonb', udt_name: 'jsonb', has_default: false },
    { table_name: 'source_apps', column_name: 'credential_mode', is_nullable: 'NO', data_type: 'USER-DEFINED', udt_name: 'CredentialMode', has_default: true },
    { table_name: 'source_apps', column_name: 'enrollment_status', is_nullable: 'NO', data_type: 'USER-DEFINED', udt_name: 'EnrollmentStatus', has_default: true },
    { table_name: 'source_apps', column_name: 'technical_group_id', is_nullable: 'YES', data_type: 'text', udt_name: 'text', has_default: false },
    { table_name: 'support_settings', column_name: 'key', is_nullable: 'NO', data_type: 'text', udt_name: 'text', has_default: false },
  ])

  expect(getColumnConfig(schema.sourceApps.enrollmentStatus).default).toBe('PENDING')
  expect(getColumnConfig(schema.sourceApps.credentialMode).default).toBe('LEGACY_BEARER')
  expect(getColumnConfig(schema.deliveryOutbox.status).default).toBe('PENDING')
  expect(getColumnConfig(schema.deliveryOutbox.channelId).notNull).toBe(false)
  expect(getColumnConfig(schema.deliveryOutbox.targetKey).notNull).toBe(true)
  expect(schema.feedbackTickets.triage.getSQLType()).toBe('jsonb')

  const constraints = await rehearsalPool.query<{ conname: string; definition: string }>(`
    select conname, pg_get_constraintdef(oid) as definition from pg_constraint
     where conname in (
       'feedback_tickets_source_app_id_source_apps_id_fk',
       'feedback_replies_feedback_id_feedback_tickets_id_fk',
       'notifications_feedback_id_feedback_tickets_id_fk',
       'password_reset_tokens_user_id_support_users_id_fk',
       'source_apps_technical_group_id_support_groups_id_fk',
       'delivery_outbox_target_source_check'
     ) order by conname
  `)
  expect(constraints.rows).toEqual([
    { conname: 'delivery_outbox_target_source_check', definition: "CHECK ((((config_source = 'DATABASE'::text) AND (channel_id IS NOT NULL) AND (target_key = ('channel:'::text || channel_id))) OR ((config_source = 'LEGACY_ENV'::text) AND (channel_id IS NULL) AND (target_key = 'legacy:central-pushover'::text) AND (channel_type = 'PUSHOVER'::\"ChannelType\"))))" },
    { conname: 'feedback_replies_feedback_id_feedback_tickets_id_fk', definition: 'FOREIGN KEY (feedback_id) REFERENCES feedback_tickets(id) ON UPDATE CASCADE ON DELETE CASCADE' },
    { conname: 'feedback_tickets_source_app_id_source_apps_id_fk', definition: 'FOREIGN KEY (source_app_id) REFERENCES source_apps(id) ON UPDATE CASCADE ON DELETE CASCADE' },
    { conname: 'notifications_feedback_id_feedback_tickets_id_fk', definition: 'FOREIGN KEY (feedback_id) REFERENCES feedback_tickets(id) ON UPDATE CASCADE ON DELETE CASCADE' },
    { conname: 'password_reset_tokens_user_id_support_users_id_fk', definition: 'FOREIGN KEY (user_id) REFERENCES support_users(id) ON UPDATE CASCADE ON DELETE CASCADE' },
    { conname: 'source_apps_technical_group_id_support_groups_id_fk', definition: 'FOREIGN KEY (technical_group_id) REFERENCES support_groups(id) ON UPDATE CASCADE ON DELETE SET NULL' },
  ])
})

it('exhaustively matches the declared schema contract to PostgreSQL catalogs', async () => {
  await applyMigration(migrationFixture())
  const contracts = task2TableContracts()
  const tableNames = contracts.map((contract) => contract.table)
  const expectedColumns = contracts.flatMap(({ columns }) => columns)
    .sort(compareContractRows)
  const actualColumns = await rehearsalPool.query<ContractColumn>(`
    select columns.table_name, columns.column_name, columns.is_nullable, columns.data_type, columns.udt_name,
      defaults.adbin is not null as has_default, pg_get_expr(defaults.adbin, defaults.adrelid) as default_expression
      from information_schema.columns columns
      join pg_class table_class on table_class.relname = columns.table_name
      join pg_namespace namespace on namespace.oid = table_class.relnamespace and namespace.nspname = columns.table_schema
      join pg_attribute attribute on attribute.attrelid = table_class.oid and attribute.attname = columns.column_name
      left join pg_attrdef defaults on defaults.adrelid = table_class.oid and defaults.adnum = attribute.attnum
     where table_schema = current_schema() and table_name = any($1::text[])
     order by table_name, ordinal_position
  `, [tableNames])
  expect(actualColumns.rows.map(withoutDefaultExpression).sort(compareContractRows)).toEqual(
    expectedColumns.map(withoutDefaultSignature),
  )
  for (const expected of expectedColumns.filter((column) => column.default_expression !== null)) {
    const actual = actualColumns.rows.find((column) => column.table_name === expected.table_name && column.column_name === expected.column_name)
    expect(actual?.default_expression).toBe(expected.default_expression)
  }

  const expectedIndexes = contracts.flatMap(({ table, indexes }) => indexes.map((index) => ({ table_name: table, ...index }))).sort(compareContractRows)
  const actualIndexes = await rehearsalPool.query<ContractIndex>(`
    select tab.relname as table_name, idx.relname as index_name, ind.indisunique as is_unique,
      coalesce(string_agg(att.attname, ',' order by key.ordinality) filter (where att.attname is not null), '') as columns,
      pg_get_expr(ind.indpred, ind.indrelid) as predicate, pg_get_indexdef(idx.oid) as definition
      from pg_index ind join pg_class idx on idx.oid = ind.indexrelid
      join pg_class tab on tab.oid = ind.indrelid join pg_namespace ns on ns.oid = tab.relnamespace
      left join lateral unnest(ind.indkey) with ordinality as key(attnum, ordinality) on true
      left join pg_attribute att on att.attrelid = tab.oid and att.attnum = key.attnum
     where ns.nspname = current_schema() and idx.relname = any($1::text[])
     group by tab.relname, idx.relname, idx.oid, ind.indisunique, ind.indpred, ind.indrelid
     order by tab.relname, idx.relname
  `, [expectedIndexes.map((index) => index.index_name)])
  expect(actualIndexes.rows.map(normalizeIndexDefinition)).toEqual(expectedIndexes)

  const actualConstraints = await rehearsalPool.query<ForeignKeyContract>(`
    select child.relname as table_name,
      string_agg(child_column.attname, ',' order by key.ordinality) as columns,
      parent.relname as foreign_table,
      con.confupdtype as on_update, con.confdeltype as on_delete
      from pg_constraint con join pg_class child on child.oid = con.conrelid
      join pg_class parent on parent.oid = con.confrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      join lateral unnest(con.conkey) with ordinality as key(attnum, ordinality) on true
      join pg_attribute child_column on child_column.attrelid = child.oid and child_column.attnum = key.attnum
     where ns.nspname = current_schema() and con.contype = 'f' and child.relname = any($1::text[])
     group by child.relname, parent.relname, con.confupdtype, con.confdeltype, con.oid
     order by child.relname, parent.relname, columns
  `, [tableNames])
  expect(actualConstraints.rows.sort(compareContractRows)).toEqual(expectedTask2ForeignKeys())

  const primaryKeys = await rehearsalPool.query<{ table_name: string; columns: string[] }>(`
    select tab.relname as table_name, string_agg(att.attname, ',' order by key.ordinality) as columns
      from pg_constraint con join pg_class tab on tab.oid = con.conrelid join pg_namespace ns on ns.oid = tab.relnamespace
      join lateral unnest(con.conkey) with ordinality as key(attnum, ordinality) on true
      join pg_attribute att on att.attrelid = tab.oid and att.attnum = key.attnum
     where ns.nspname = current_schema() and con.contype = 'p' and tab.relname = any($1::text[])
     group by tab.relname order by tab.relname
  `, [tableNames])
  expect(primaryKeys.rows).toEqual(contracts.map(({ table, primary_key }) => ({ table_name: table, columns: primary_key.join(',') })).sort(compareContractRows))

  const checks = await rehearsalPool.query<CheckContract>(`
    select table_class.relname as table_name, con.conname,
      pg_get_constraintdef(con.oid) as definition
      from pg_constraint con join pg_class table_class on table_class.oid = con.conrelid
      join pg_namespace namespace on namespace.oid = table_class.relnamespace
     where namespace.nspname = current_schema() and con.contype = 'c'
       and table_class.relname = any($1::text[])
     order by table_class.relname, con.conname
  `, [tableNames])
  expect(checks.rows).toEqual(expectedCheckConstraints())
})

it('rejects a database-backed outbox target without its database channel', async () => {
  await applyMigration(migrationFixture())
  await rehearsalPool.query(`insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
    values ('legacy-event', 'legacy-ticket', 1, 'legacy-event', '{}'::jsonb, now()) on conflict do nothing`)
  await expect(rehearsalPool.query(`insert into delivery_outbox (
    id, escalation_event_id, event_key, target_key, generation, channel_type, config_source,
    rendered_payload, status, next_attempt_at, created_at, updated_at
  ) values ('invalid-database-target', 'legacy-event', 'legacy-event', 'channel:missing', 1,
    'EMAIL', 'DATABASE', '{}'::jsonb, 'PENDING', now(), now(), now())`)).rejects.toThrow('delivery_outbox_target_source_check')
})

function migrationFixture() {
  return { name: '0001_support_portal_core', sqlText: supportMigrationSql, pool: rehearsalPool }
}

function getColumnConfig(column: unknown): { default: unknown; notNull: boolean } {
  return (column as { config: { default: unknown; notNull: boolean } }).config
}

type ContractColumn = { table_name: string; column_name: string; is_nullable: string; data_type: string; udt_name: string; has_default: boolean; default_expression?: string | null }
type ContractIndex = { table_name: string; index_name: string; is_unique: boolean; columns: string; predicate: string | null; definition?: string }
type ForeignKeyContract = { table_name: string; columns: string; foreign_table: string; on_update: string; on_delete: string }
type CheckContract = { table_name: string; conname: string; definition: string }
type DrizzleColumn = { name: string; primary: boolean; notNull: boolean; default: unknown; getSQLType(): string; enum?: { enumName: string } }

function task2TableContracts() {
  const tables = [schema.supportUsers, schema.supportGroups, schema.sourceApps, schema.feedbackTickets, schema.feedbackReplies, schema.notifications, schema.authLoginAttempts, schema.passwordResetTokens, schema.appEnrollmentGrants, schema.appCredentials, schema.serviceAssertionReplays, schema.ingestReceipts, schema.escalationEvents, schema.routingIncidents, schema.supportGroupMembers, schema.notificationChannels, schema.appNotificationPolicies, schema.deliveryOutbox, schema.deliveryAttempts, schema.auditEvents, schema.serviceRateLimitBuckets, schema.supportSettings]
  return tables.map((table) => {
    const config = getTableConfig(table)
    return {
      table: config.name,
      primary_key: (config.columns as unknown as DrizzleColumn[]).filter((column) => column.primary).map((column) => column.name),
      columns: (config.columns as unknown as DrizzleColumn[]).map((column) => columnContract(config.name, column)),
      indexes: config.indexes.map((index) => {
        const indexName = requiredIndexName(index.config.name)
        const columns = index.config.columns.map((column) => indexedColumnName(column as { name?: string })).join(',')
        return {
          index_name: indexName,
          is_unique: index.config.unique,
          columns,
          predicate: indexPredicate(indexName),
          definition: expectedIndexDefinition(config.name, indexName, index.config.unique, columns, indexPredicate(indexName)),
        }
      }),
    }
  })
}

function columnContract(table_name: string, column: DrizzleColumn): ContractColumn {
  const sqlType = column.getSQLType()
  const enumType = column.enum?.enumName as string | undefined
  const defaultValue = column.default
  return {
    table_name, column_name: column.name, is_nullable: column.notNull ? 'NO' : 'YES',
    data_type: enumType ? 'USER-DEFINED' : sqlType.startsWith('timestamp') ? sqlType.includes('with time zone') ? 'timestamp with time zone' : 'timestamp without time zone' : sqlType,
    udt_name: enumType ?? (sqlType === 'integer' ? 'int4' : sqlType === 'boolean' ? 'bool' : sqlType.startsWith('timestamp') ? sqlType.includes('with time zone') ? 'timestamptz' : 'timestamp' : sqlType),
    has_default: defaultValue !== undefined,
    default_expression: defaultExpression(sqlType, enumType, defaultValue),
  }
}

function withoutDefaultExpression(row: ContractColumn): Omit<ContractColumn, 'default_expression'> {
  const column = { ...row }
  delete column.default_expression
  return column
}

function withoutDefaultSignature(row: ContractColumn): Omit<ContractColumn, 'default_expression'> {
  const column = { ...row }
  delete column.default_expression
  return column
}

function indexedColumnName(column: { name?: string }): string {
  if (!column.name) throw new Error('Task 2 indexes must use named columns')
  return column.name
}

function requiredIndexName(name: string | undefined): string {
  if (!name) throw new Error('Schema indexes must be named')
  return name
}

function defaultExpression(sqlType: string, enumType: string | undefined, value: unknown): string | null {
  if (value === undefined) return null
  if (enumType) return `'${String(value)}'::"${enumType}"`
  if (sqlType === 'text') return `'${String(value).replaceAll("'", "''")}'::text`
  if (sqlType === 'boolean' || sqlType === 'integer') return String(value)
  if (sqlType === 'jsonb') return `'${JSON.stringify(value)}'::jsonb`
  throw new Error(`Unexpected default type in schema contract: ${sqlType}`)
}

function indexPredicate(indexName: string): string | null {
  if (indexName === 'notifications_unread_idx') return '(read_at IS NULL)'
  if (indexName === 'support_groups_one_central_fallback_idx') return 'is_central_fallback'
  return null
}

function expectedIndexDefinition(
  table: string,
  name: string,
  unique: boolean,
  columns: string,
  predicate: string | null,
): string {
  return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table} USING btree (${columns})${predicate ? ` WHERE ${predicate}` : ''}`
}

function normalizeIndexDefinition(index: ContractIndex): ContractIndex {
  const definition = index.definition
    ?.replace(/\s+/g, ' ')
    .replace(/ON [^. ]+\.([a-z_]+) USING/, 'ON $1 USING')
    .replace(/, /g, ',')
    .trim()
  return { ...index, definition }
}

function expectedCheckConstraints(): CheckContract[] {
  return [{
    table_name: 'delivery_outbox',
    conname: 'delivery_outbox_target_source_check',
    definition: "CHECK ((((config_source = 'DATABASE'::text) AND (channel_id IS NOT NULL) AND (target_key = ('channel:'::text || channel_id))) OR ((config_source = 'LEGACY_ENV'::text) AND (channel_id IS NULL) AND (target_key = 'legacy:central-pushover'::text) AND (channel_type = 'PUSHOVER'::\"ChannelType\"))))",
  }]
}

function expectedTask2ForeignKeys(): ForeignKeyContract[] {
  return [
    ['app_credentials', ['revoked_by_user_id'], 'support_users', 'c', 'n'], ['app_credentials', ['rotation_parent_id'], 'app_credentials', 'c', 'n'], ['app_credentials', ['source_app_id'], 'source_apps', 'c', 'c'],
    ['app_enrollment_grants', ['created_by_user_id'], 'support_users', 'c', 'n'], ['app_enrollment_grants', ['source_app_id'], 'source_apps', 'c', 'c'], ['app_notification_policies', ['source_app_id'], 'source_apps', 'c', 'c'],
    ['delivery_attempts', ['outbox_id'], 'delivery_outbox', 'c', 'n'], ['delivery_outbox', ['channel_id'], 'notification_channels', 'c', 'n'], ['delivery_outbox', ['escalation_event_id'], 'escalation_events', 'c', 'c'], ['feedback_tickets', ['source_app_id'], 'source_apps', 'c', 'c'],
    ['feedback_replies', ['feedback_id'], 'feedback_tickets', 'c', 'c'], ['notifications', ['feedback_id'], 'feedback_tickets', 'c', 'c'], ['password_reset_tokens', ['user_id'], 'support_users', 'c', 'c'],
    ['escalation_events', ['ticket_id'], 'feedback_tickets', 'c', 'c'], ['ingest_receipts', ['source_app_id'], 'source_apps', 'c', 'c'], ['ingest_receipts', ['ticket_id'], 'feedback_tickets', 'c', 'n'],
    ['notification_channels', ['group_id'], 'support_groups', 'c', 'c'], ['routing_incidents', ['escalation_event_id'], 'escalation_events', 'c', 'c'], ['service_assertion_replays', ['credential_id'], 'app_credentials', 'c', 'c'],
    ['source_apps', ['technical_group_id'], 'support_groups', 'c', 'n'], ['support_group_members', ['group_id'], 'support_groups', 'c', 'c'], ['support_group_members', ['support_user_id'], 'support_users', 'c', 'n'],
  ].map(([table_name, columns, foreign_table, on_update, on_delete]) => ({ table_name: table_name as string, columns: (columns as string[]).join(','), foreign_table: foreign_table as string, on_update: on_update as string, on_delete: on_delete as string })).sort(compareContractRows)
}

function compareContractRows(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}

async function expectNamedIndexes(expected: string[]): Promise<void> {
  const indexes = await rehearsalPool.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = current_schema() and indexname = any($1::text[]) order by indexname`,
    [expected],
  )
  expect(indexes.rows.map((row) => row.indexname)).toEqual([...expected].sort())
}

async function createExactCurrentSchema(pool: Pool): Promise<void> {
  await pool.query(`
    create type "AppStatus" as enum ('ACTIVE', 'PAUSED');
    create type "FeedbackKind" as enum ('BUG', 'EVOLUTION');
    create type "FeedbackPriority" as enum ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
    create type "FeedbackStatus" as enum ('NEW', 'IN_REVIEW', 'BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FIXED', 'SHIPPED', 'DECLINED', 'CLOSED');
    create type "NotificationKind" as enum ('STATUS_CHANGE', 'ADMIN_REPLY', 'COMBINED', 'SYNC_ERROR');
    create type "AuthUserRole" as enum ('ADMIN', 'SUPPORT');
    create type "AuthUserStatus" as enum ('ACTIVE', 'DISABLED');
    create table source_apps (
      id text primary key, slug text not null, name text not null, base_url text,
      environment text not null default 'production', status "AppStatus" not null default 'ACTIVE',
      last_seen_at timestamp(3), metadata jsonb, created_at timestamp(3) not null, updated_at timestamp(3) not null
    );
    create unique index source_apps_slug_idx on source_apps (slug);
    create index source_apps_status_idx on source_apps (status);
    create table support_users (
      id text primary key, email text not null, name text not null, role "AuthUserRole" not null default 'SUPPORT',
      status "AuthUserStatus" not null default 'ACTIVE', password_hash text not null, last_login_at timestamp(3),
      created_at timestamp(3) not null, updated_at timestamp(3) not null
    );
    create unique index support_users_email_idx on support_users (email);
    create index support_users_role_idx on support_users (role);
    create index support_users_status_idx on support_users (status);
    create table feedback_tickets (
      id text primary key, source_app_id text not null,
      external_id text not null, kind "FeedbackKind" not null, status "FeedbackStatus" not null default 'NEW',
      priority "FeedbackPriority" not null default 'MEDIUM', title text not null, description text not null,
      reporter_name text, reporter_email text, reporter_id text, url text, browser_info text, markdown_spec text,
      transcript jsonb, raw_payload jsonb not null, remote_created_at timestamp(3), remote_updated_at timestamp(3),
      last_status_change_at timestamp(3), last_synced_at timestamp(3) not null, created_at timestamp(3) not null,
      updated_at timestamp(3) not null,
      constraint feedback_tickets_source_app_id_source_apps_id_fk foreign key (source_app_id) references source_apps(id) on update cascade on delete cascade
    );
    create unique index feedback_tickets_source_external_idx on feedback_tickets (source_app_id, external_id);
    create index feedback_tickets_status_idx on feedback_tickets (status);
    create index feedback_tickets_kind_idx on feedback_tickets (kind);
    create index feedback_tickets_priority_idx on feedback_tickets (priority);
    create index feedback_tickets_app_status_idx on feedback_tickets (source_app_id, status);
    create table feedback_replies (
      id text primary key, feedback_id text not null, author_name text not null, author_email text, body text not null,
      is_synced_back boolean not null default false, created_at timestamp(3) not null,
      constraint feedback_replies_feedback_id_feedback_tickets_id_fk foreign key (feedback_id) references feedback_tickets(id) on update cascade on delete cascade
    );
    create index feedback_replies_feedback_id_idx on feedback_replies (feedback_id, created_at);
    create table notifications (
      id text primary key, feedback_id text, kind "NotificationKind" not null, body text not null, link text not null,
      read_at timestamp(3), created_at timestamp(3) not null,
      constraint notifications_feedback_id_feedback_tickets_id_fk foreign key (feedback_id) references feedback_tickets(id) on update cascade on delete cascade
    );
    create index notifications_unread_idx on notifications (read_at) where read_at is null;
    create index notifications_created_idx on notifications (created_at);
    create table auth_login_attempts (
      id text primary key, identifier text not null, ip_address text, user_agent text,
      success boolean not null default false, created_at timestamp(3) not null
    );
    create index auth_login_attempts_identifier_created_idx on auth_login_attempts (identifier, created_at);
    create index auth_login_attempts_ip_created_idx on auth_login_attempts (ip_address, created_at);
    create table password_reset_tokens (
      id text primary key, user_id text not null, token_hash text not null, requested_ip text, user_agent text,
      expires_at timestamp(3) not null, used_at timestamp(3), created_at timestamp(3) not null,
      constraint password_reset_tokens_user_id_support_users_id_fk foreign key (user_id) references support_users(id) on update cascade on delete cascade
    );
    create unique index password_reset_tokens_hash_idx on password_reset_tokens (token_hash);
    create index password_reset_tokens_user_created_idx on password_reset_tokens (user_id, created_at);
    create index password_reset_tokens_expires_idx on password_reset_tokens (expires_at);
    insert into source_apps (id, slug, name, metadata, created_at, updated_at) values ('legacy-app', 'legacy-app', 'Legacy app', '{"legacyPushover":true}'::jsonb, now(), now());
    insert into support_users (id, email, name, password_hash, created_at, updated_at) values ('legacy-user', 'legacy@example.test', 'Legacy user', 'hash', now(), now());
    insert into feedback_tickets (id, source_app_id, external_id, kind, title, description, raw_payload, last_synced_at, created_at, updated_at) values ('legacy-ticket', 'legacy-app', 'legacy-1', 'BUG', 'Legacy ticket', 'Preserve this', '{}'::jsonb, now(), now(), now());
    insert into feedback_replies (id, feedback_id, author_name, body, created_at) values ('legacy-reply', 'legacy-ticket', 'Legacy user', 'Still investigating', now());
    insert into notifications (id, feedback_id, kind, body, link, created_at) values ('legacy-notification', 'legacy-ticket', 'STATUS_CHANGE', 'Updated', '/tickets/legacy-ticket', now());
    insert into auth_login_attempts (id, identifier, success, created_at) values ('legacy-login', 'legacy@example.test', true, now());
    insert into password_reset_tokens (id, user_id, token_hash, expires_at, created_at) values ('legacy-reset', 'legacy-user', 'digest', now() + interval '1 hour', now());
  `)
}
