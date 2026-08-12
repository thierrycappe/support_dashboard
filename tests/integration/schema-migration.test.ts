import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeDbPool, getDbPool } from '@/lib/db'
import { applyMigration } from '@/lib/db/migrations'
import * as schema from '@/lib/db/schema'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

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
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`)
  await fixture.pool.query(
    'delete from support_schema_migrations where name = $1',
    [fixture.name],
  )
  await fixture.pool.query(`create schema ${rehearsalSchema}`)
  rehearsalPool = new Pool({
    connectionString: requireTestDatabaseUrl(),
    options: `-c search_path=${rehearsalSchema}`,
  })
  await createCurrentSchema(rehearsalPool)
})

afterAll(async () => {
  await rehearsalPool?.end()
  await fixture.pool.query(`drop table if exists ${fixtureTable}`)
  await fixture.pool.query(
    'delete from support_schema_migrations where name = $1',
    [fixture.name],
  )
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

it('upgrades representative legacy rows without rewriting them and remains idempotent', async () => {
  const migration = { name: '0001_support_portal_core', sqlText: supportMigrationSql, pool: rehearsalPool }

  expect(await applyMigration(migration)).toBe('applied')
  expect(await applyMigration(migration)).toBe('already-applied')

  const [app, ticket, user] = await Promise.all([
    rehearsalPool.query<{ id: string; slug: string; enrollment_status: string | null }>(
      "select id, slug, enrollment_status from source_apps where id = 'legacy-app'",
    ),
    rehearsalPool.query<{ id: string; title: string; triage: unknown }>(
      "select id, title, triage from feedback_tickets where id = 'legacy-ticket'",
    ),
    rehearsalPool.query<{ id: string; email: string }>(
      "select id, email from support_users where id = 'legacy-user'",
    ),
  ])
  expect(app.rows).toEqual([{ id: 'legacy-app', slug: 'legacy-app', enrollment_status: 'PENDING' }])
  expect(ticket.rows).toEqual([{ id: 'legacy-ticket', title: 'Legacy ticket', triage: null }])
  expect(user.rows).toEqual([{ id: 'legacy-user', email: 'legacy@example.test' }])

  const enumValues = await rehearsalPool.query<{ enumlabel: string }>(
    `select enumlabel from pg_enum where enumtypid = '"DeliveryStatus"'::regtype order by enumsortorder`,
  )
  expect(enumValues.rows.map((row) => row.enumlabel)).toEqual([
    'PENDING', 'LEASED', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED',
  ])

  const columns = await rehearsalPool.query<{ table_name: string; column_name: string; is_nullable: string }>(
    `select table_name, column_name, is_nullable
       from information_schema.columns
      where table_schema = current_schema()
        and (table_name, column_name) in (
          ('source_apps', 'technical_group_id'),
          ('feedback_tickets', 'triage'),
          ('delivery_outbox', 'channel_id'),
          ('delivery_outbox', 'target_key'),
          ('support_settings', 'key')
        )
      order by table_name, column_name`,
  )
  expect(columns.rows).toEqual([
    { table_name: 'delivery_outbox', column_name: 'channel_id', is_nullable: 'YES' },
    { table_name: 'delivery_outbox', column_name: 'target_key', is_nullable: 'NO' },
    { table_name: 'feedback_tickets', column_name: 'triage', is_nullable: 'YES' },
    { table_name: 'source_apps', column_name: 'technical_group_id', is_nullable: 'YES' },
    { table_name: 'support_settings', column_name: 'key', is_nullable: 'NO' },
  ])

  const indexes = await rehearsalPool.query<{ indexname: string }>(
    `select indexname from pg_indexes
      where schemaname = current_schema()
        and indexname in (
          'app_credentials_app_status_idx',
          'app_credentials_thumbprint_idx',
          'audit_events_subject_created_idx',
          'delivery_outbox_claim_idx',
          'delivery_outbox_channel_created_idx',
          'delivery_outbox_event_target_generation_idx',
          'escalation_events_ticket_generation_idx',
          'feedback_tickets_open_queue_idx',
          'service_assertion_replays_expires_idx',
          'source_apps_last_ingested_idx'
        )
      order by indexname`,
  )
  expect(indexes.rows.map((row) => row.indexname)).toEqual([
    'app_credentials_app_status_idx',
    'app_credentials_thumbprint_idx',
    'audit_events_subject_created_idx',
    'delivery_outbox_channel_created_idx',
    'delivery_outbox_claim_idx',
    'delivery_outbox_event_target_generation_idx',
    'escalation_events_ticket_generation_idx',
    'feedback_tickets_open_queue_idx',
    'service_assertion_replays_expires_idx',
    'source_apps_last_ingested_idx',
  ])

  const coreTables = await rehearsalPool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = current_schema()
        and table_name in (
          'app_credentials', 'app_enrollment_grants', 'app_notification_policies', 'audit_events',
          'delivery_attempts', 'delivery_outbox', 'escalation_events', 'ingest_receipts',
          'notification_channels', 'routing_incidents', 'service_assertion_replays',
          'service_rate_limit_buckets', 'support_group_members', 'support_groups', 'support_settings'
        ) order by table_name`,
  )
  expect(coreTables.rows.map((table) => table.table_name)).toEqual([
    'app_credentials', 'app_enrollment_grants', 'app_notification_policies', 'audit_events',
    'delivery_attempts', 'delivery_outbox', 'escalation_events', 'ingest_receipts',
    'notification_channels', 'routing_incidents', 'service_assertion_replays',
    'service_rate_limit_buckets', 'support_group_members', 'support_groups', 'support_settings',
  ])

  const foreignKeys = await rehearsalPool.query<{ conname: string; definition: string }>(
    `select conname, pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conrelid in ('source_apps'::regclass, 'delivery_outbox'::regclass)
        and contype = 'f'
      order by conname`,
  )
  expect(foreignKeys.rows).toContainEqual({
    conname: 'source_apps_technical_group_id_support_groups_id_fk',
    definition: 'FOREIGN KEY (technical_group_id) REFERENCES support_groups(id) ON UPDATE CASCADE ON DELETE SET NULL',
  })
  expect(foreignKeys.rows.some((key) => key.definition.includes('FOREIGN KEY (channel_id) REFERENCES notification_channels(id) ON UPDATE CASCADE ON DELETE SET NULL'))).toBe(true)

  expect(schema.escalationEvents.ticketId.name).toBe('ticket_id')
  expect(schema.deliveryOutbox.targetKey.name).toBe('target_key')
  expect(schema.deliveryOutbox.channelId.name).toBe('channel_id')
  expect(schema.routingIncidents.escalationEventId.name).toBe('escalation_event_id')
  expect(schema.supportSettings.key.name).toBe('key')
  expect(schema.appEnrollmentGrants.tokenDigest.name).toBe('token_digest')
  expect(schema.appCredentials.publicKeyThumbprint.name).toBe('public_key_thumbprint')
  expect(schema.ingestReceipts.idempotencyKey.name).toBe('idempotency_key')
  expect(schema.deliveryAttempts.ordinal.name).toBe('ordinal')
  expect(schema.auditEvents.subjectId.name).toBe('subject_id')
  expect(schema.serviceRateLimitBuckets.windowStart.name).toBe('window_start')
})

it('rejects a database-backed outbox target without its database channel', async () => {
  const migration = { name: '0001_support_portal_core', sqlText: supportMigrationSql, pool: rehearsalPool }
  await applyMigration(migration)
  await rehearsalPool.query(`
    insert into escalation_events (id, ticket_id, generation, event_key, payload, created_at)
    values ('legacy-event', 'legacy-ticket', 1, 'legacy-event', '{}'::jsonb, now())
    on conflict do nothing
  `)

  await expect(
    rehearsalPool.query(`
      insert into delivery_outbox (
        id, escalation_event_id, event_key, target_key, generation, channel_type, config_source,
        rendered_payload, status, next_attempt_at, created_at, updated_at
      ) values (
        'invalid-database-target', 'legacy-event', 'legacy-event', 'channel:missing', 1,
        'EMAIL', 'DATABASE', '{}'::jsonb, 'PENDING', now(), now(), now()
      )
    `),
  ).rejects.toThrow('delivery_outbox_target_source_check')
})

async function createCurrentSchema(pool: Pool): Promise<void> {
  await pool.query(`
    create type "AppStatus" as enum ('ACTIVE', 'PAUSED');
    create type "FeedbackKind" as enum ('BUG', 'EVOLUTION');
    create type "FeedbackPriority" as enum ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
    create type "FeedbackStatus" as enum ('NEW', 'IN_REVIEW', 'BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FIXED', 'SHIPPED', 'DECLINED', 'CLOSED');
    create type "AuthUserRole" as enum ('ADMIN', 'SUPPORT');
    create type "AuthUserStatus" as enum ('ACTIVE', 'DISABLED');
    create table source_apps (
      id text primary key, slug text not null unique, name text not null, base_url text,
      environment text not null default 'production', status "AppStatus" not null default 'ACTIVE',
      last_seen_at timestamptz(3), metadata jsonb, created_at timestamptz(3) not null, updated_at timestamptz(3) not null
    );
    create table support_users (
      id text primary key, email text not null unique, name text not null,
      role "AuthUserRole" not null default 'SUPPORT', status "AuthUserStatus" not null default 'ACTIVE',
      password_hash text not null, last_login_at timestamptz(3), created_at timestamptz(3) not null, updated_at timestamptz(3) not null
    );
    create table feedback_tickets (
      id text primary key, source_app_id text not null references source_apps(id) on update cascade on delete cascade,
      external_id text not null, kind "FeedbackKind" not null, status "FeedbackStatus" not null default 'NEW',
      priority "FeedbackPriority" not null default 'MEDIUM', title text not null, description text not null,
      reporter_name text, reporter_email text, reporter_id text, url text, browser_info text, markdown_spec text,
      transcript jsonb, raw_payload jsonb not null, remote_created_at timestamptz(3), remote_updated_at timestamptz(3),
      last_status_change_at timestamptz(3), last_synced_at timestamptz(3) not null, created_at timestamptz(3) not null,
      updated_at timestamptz(3) not null, unique(source_app_id, external_id)
    );
    insert into source_apps (id, slug, name, metadata, created_at, updated_at)
      values ('legacy-app', 'legacy-app', 'Legacy app', '{"legacyPushover":true}'::jsonb, now(), now());
    insert into support_users (id, email, name, password_hash, created_at, updated_at)
      values ('legacy-user', 'legacy@example.test', 'Legacy user', 'hash', now(), now());
    insert into feedback_tickets (id, source_app_id, external_id, kind, title, description, raw_payload, last_synced_at, created_at, updated_at)
      values ('legacy-ticket', 'legacy-app', 'legacy-1', 'BUG', 'Legacy ticket', 'Preserve this', '{}'::jsonb, now(), now(), now());
  `)
}
