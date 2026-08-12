# Support Portal Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Support Tower as a durable second-tier escalation portal with administrator-approved public-key enrollment, transactional alert delivery, per-app technical ownership, and a polished operations interface.

**Architecture:** Keep a Next.js modular monolith and Postgres, but replace the non-transactional Neon HTTP connection with a transaction-capable `node-postgres` pool. All legacy and versioned intake paths call one transactional service that writes the ticket, receipt, audit event, and delivery outbox together. Implement the approved work in five reviewable milestones: durable core, routing operations, public-key enrollment, product UI, and release verification.

**Tech Stack:** Next.js 16.2.5, React 19.2.6, TypeScript 5.9.3, Postgres, Drizzle ORM 0.45.2, node-postgres 8.22.0, jose 6.2.3, Zod 4.2.1, Vitest 4.0.15, Playwright 1.57.0, Lucide React.

## Global Constraints

- Central portal only. Source-application feedback systems are not modified in this plan.
- Business owners triage raw feedback in source apps; Support Tower receives only approved bugs and feature requests.
- Unknown apps cannot self-register. Enrollment requires an administrator-created, 30-minute, single-use invitation.
- New connectors use Ed25519 public keys and five-minute scoped access tokens. The portal never stores source private keys or reusable ingest secrets for new connectors.
- Legacy bearer ingest, full pull, and manual refresh remain operational until a separately authorized source-app migration.
- Accepted escalation, receipt, audit event, and delivery targets commit atomically in Postgres.
- At-least-once notification delivery uses Postgres outbox rows, leases, durable attempts, retries for 24 hours, and visible terminal failures.
- App technical owner groups receive normal alerts. Urgent alerts and invalid app routing also reach the central fallback group.
- Initial adapters are email, Pushover compatibility, and a timestamped HMAC-signed generic webhook.
- Capacity is 100 to 500 enrollments per year and at most about 500 escalations across the portal on a peak day.
- On representative deployed infrastructure, authenticated intake targets p95 below two seconds and healthy-channel first-attempt p95 below 60 seconds.
- UI is light-first with dark parity, OKLCH tokens, WCAG 2.1 AA contrast, keyboard access, reduced-motion behavior, and no em dash in shipped copy.
- UI bans: side-stripe alert accents, gradient text, decorative gradients, glassmorphism, hero metric cards, identical card grids, greeting theatre, emoji, and decorative motion.
- Every implementation behavior follows strict red-green-refactor. The test must fail for the expected missing behavior before production code is written.
- Tests assert real outcomes, not mock existence. External providers are replaced only at the HTTP boundary.
- Database changes are additive until legacy retirement. No production migration or deployment occurs inside an implementation task without separate operational authorization.
- Before any Vercel release using `node-postgres`, verify that `DATABASE_URL` is the provider's pooled Postgres endpoint and keep `DATABASE_POOL_MAX` within the approved connection budget.
- Each implementation task is routed to Terra with high reasoning. Security and final specification reviews are routed to Sol. Merge and deployment control prefer Luna when that runtime is available.

---

## File Structure

### Durable core

- `lib/db/index.ts`: transaction-capable connection pool and Drizzle instance.
- `lib/db/schema.ts`: persisted domain schema and indexes.
- `lib/db/migrations.ts`: checksum-verified additive migration runner.
- `drizzle/0001_support_portal_core.sql`: additive existing-database migration.
- `lib/escalations/contract.ts`: version 1 and legacy normalization contracts.
- `lib/escalations/intake.ts`: transaction orchestration and idempotency.
- `lib/escalations/repository.ts`: Drizzle statements used by intake.
- `lib/escalations/errors.ts`: stable domain and public error codes.
- `lib/delivery/types.ts`: channel, target, job, and result interfaces.
- `lib/delivery/policy.ts`: pure per-app and central-fallback routing.
- `lib/delivery/worker.ts`: claim, dispatch, retry, and terminal transitions.
- `lib/delivery/repository.ts`: outbox lease and attempt persistence.
- `lib/delivery/adapters/email.ts`: Resend-compatible email adapter.
- `lib/delivery/adapters/pushover.ts`: Pushover adapter around the existing transport.
- `lib/delivery/adapters/webhook.ts`: timestamped HMAC webhook adapter.
- `app/api/cron/deliver-alerts/route.ts`: authorized recovery sweep.

### Routing operations

- `lib/routing/crypto.ts`: AES-256-GCM versioned channel configuration encryption.
- `lib/routing/groups.ts`: group and membership persistence.
- `lib/routing/channels.ts`: encrypted channel persistence and redacted read models.
- `lib/routing/policies.ts`: per-app notification policy persistence.
- `app/teams/actions.ts`: admin-only group and channel mutations.
- `app/apps/actions.ts`: app, ownership, and policy mutations.
- `scripts/backfill-support-routing.ts`: idempotent central fallback and legacy-channel backfill.

### Public-key enrollment

- `lib/service-auth/invitations.ts`: invitation creation, hashing, expiry, consumption, and revocation.
- `lib/service-auth/jwk.ts`: Ed25519 public-JWK validation and thumbprints.
- `lib/service-auth/assertions.ts`: client-assertion verification and replay prevention.
- `lib/service-auth/access-tokens.ts`: five-minute portal access-token issuance and verification.
- `lib/service-auth/rate-limit.ts`: database-backed enrollment, token, and ingest limits.
- `lib/service-auth/credentials.ts`: credential lifecycle and rotation challenge.
- `lib/service-auth/guards.ts`: route-level service-token requirement.
- `app/api/v1/enrollments/exchange/route.ts`: public invitation exchange.
- `app/api/v1/service-tokens/route.ts`: public client-assertion exchange.
- `app/api/v1/escalations/route.ts`: scoped version 1 escalation intake.
- `app/api/v1/credentials/rotate/route.ts`: next-key registration.
- `app/api/v1/credentials/rotate/confirm/route.ts`: next-key proof and activation.
- `scripts/generate-service-signing-key.ts`: local portal signing-key generator.

### Product UI

- `components/AppShell.tsx`: semantic product shell.
- `components/NavLinks.tsx`: active responsive navigation.
- `components/ThemeToggle.tsx`: persisted theme preference.
- `components/ui/Button.tsx`, `Badge.tsx`, `InlineNotice.tsx`, `EmptyState.tsx`, `DataTable.tsx`, `Pagination.tsx`: reusable component vocabulary.
- `app/globals.css`: approved token system, layouts, states, responsive rules, and reduced motion.
- `app/page.tsx`: Escalations queue.
- `lib/escalations/queries.ts`: filtered keyset queue and summary queries.
- `app/apps/page.tsx`, `app/apps/new/page.tsx`, `app/apps/[id]/page.tsx`: app list, enrollment, and detail.
- `components/enrollment/EnrollmentFlow.tsx`: four-step app enrollment.
- `app/deliveries/page.tsx`, `app/deliveries/actions.ts`: delivery operations.
- `app/teams/page.tsx`: technical groups and channels.
- `app/access/page.tsx`: portal users, credential security, and audit.
- `app/feedback/[id]/page.tsx`: escalation and delivery timeline detail.

### Verification and documentation

- `tests/integration/helpers/database.ts`: disposable Postgres lifecycle.
- `vitest.integration.config.ts`: serial Postgres integration suite.
- `e2e/setup/auth.setup.ts`: authenticated Playwright setup.
- `e2e/scenarios/control-tower/SCN-005.spec.ts` through `SCN-010.spec.ts`: new journeys.
- `scripts/load-escalations.ts`: repeatable 500-item burst harness.
- `scripts/verify-support-overhaul.ts`: full release gate.
- `DESIGN.md`, `ARCHITECTURE.md`, `SECURITY.md`, `.env.example`, `CHANGELOG.md`, `TODOS.md`, `scenarios/control-tower/*.md`: reconciled operator and connector documentation.

---

## Milestone 1: Durable Intake and Delivery Core

### Task 1: Transaction-Capable Database Driver and Integration Harness

**Routing:** Terra, high. Sol reviews the driver and transaction boundary after Task 5.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/db/index.ts`
- Create: `tests/integration/helpers/database.ts`
- Create: `tests/integration/db-transaction.test.ts`
- Create: `vitest.integration.config.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` in production and `TEST_DATABASE_URL` in integration tests.
- Produces: `getDb(): NodePgDatabase<typeof schema>`, `getDbPool(): Pool`, `closeDbPool(): Promise<void>`.

- [ ] **Step 1: Write the failing rollback test**

```ts
// tests/integration/db-transaction.test.ts
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeDbPool, getDb } from '@/lib/db'
import { requireTestDatabaseUrl } from '@/tests/integration/helpers/database'

beforeAll(async () => {
  process.env.DATABASE_URL = requireTestDatabaseUrl()
  await getDb().execute(sql`create table if not exists transaction_probe (
    id text primary key
  )`)
  await getDb().execute(sql`delete from transaction_probe`)
})

afterAll(async () => {
  await getDb().execute(sql`drop table if exists transaction_probe`)
  await closeDbPool()
})

it('rolls back every statement when a transaction callback fails', async () => {
  await expect(
    getDb().transaction(async (tx) => {
      await tx.execute(sql`insert into transaction_probe (id) values ('rolled-back')`)
      throw new Error('force rollback')
    }),
  ).rejects.toThrow('force rollback')

  const result = await getDb().execute<{ count: number }>(
    sql`select count(*)::int as count from transaction_probe`,
  )
  expect(result.rows[0]?.count).toBe(0)
})
```

- [ ] **Step 2: Run the test and verify the current driver cannot satisfy it**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run --config vitest.integration.config.ts tests/integration/db-transaction.test.ts`

Expected: FAIL because the current `neon-http` database cannot execute the interactive transaction against the disposable Postgres endpoint.

- [ ] **Step 3: Install direct dependencies and replace the driver**

Run:

```bash
npm install pg@8.22.0 jose@6.2.3
npm install --save-dev @types/pg
npm uninstall @neondatabase/serverless
```

Implement `lib/db/index.ts`:

```ts
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

const globalDb = globalThis as typeof globalThis & {
  supportTowerPool?: Pool
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export function getDbPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not configured')

  globalDb.supportTowerPool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
  return globalDb.supportTowerPool
}

export function getDb() {
  return drizzle(getDbPool(), { schema })
}

export async function closeDbPool(): Promise<void> {
  if (!globalDb.supportTowerPool) return
  const pool = globalDb.supportTowerPool
  delete globalDb.supportTowerPool
  await pool.end()
}

export type Db = ReturnType<typeof getDb>
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]
```

`tests/integration/helpers/database.ts` must set `process.env.DATABASE_URL` from `TEST_DATABASE_URL`, expose `requireTestDatabaseUrl()`, and refuse URLs whose database name does not end in `_test` or whose query does not include `support_test=1`.

- [ ] **Step 4: Add the serial integration configuration**

```ts
// vitest.integration.config.ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

- [ ] **Step 5: Run focused and baseline verification**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run --config vitest.integration.config.ts tests/integration/db-transaction.test.ts
npm run test:run
npm run typecheck
```

Expected: rollback test passes, 63 existing unit tests pass, and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/db/index.ts tests/integration/helpers/database.ts tests/integration/db-transaction.test.ts vitest.integration.config.ts
git commit -m "refactor: enable transactional postgres access"
```

### Task 2: Additive Core Schema and Checksum-Verified Migration

**Routing:** Terra, high.

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations.ts`
- Create: `drizzle/0001_support_portal_core.sql`
- Create: `scripts/apply-support-migrations.ts`
- Create: `tests/integration/schema-migration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 `getDbPool()`.
- Produces: all approved tables plus `applyMigration({ name, sqlText, pool }): Promise<'applied' | 'already-applied'>`.

- [ ] **Step 1: Write failing migration behavior tests**

```ts
// tests/integration/schema-migration.test.ts
import { getDbPool } from '@/lib/db'
import { applyMigration } from '@/lib/db/migrations'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()

const fixture = {
  name: `integration_fixture_${process.pid}`,
  sqlText: 'create table if not exists migration_fixture (id text primary key);',
  pool: getDbPool(),
}

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
```

Expected break caught: executing the same DDL twice or silently changing applied SQL.

- [ ] **Step 2: Run RED**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run --config vitest.integration.config.ts tests/integration/schema-migration.test.ts`

Expected: FAIL because `applyMigration` does not exist.

- [ ] **Step 3: Declare the exact schema**

Add enums:

```ts
export const enrollmentStatus = pgEnum('EnrollmentStatus', [
  'PENDING', 'ACTIVE', 'PAUSED', 'REVOKED',
])
export const credentialMode = pgEnum('CredentialMode', ['LEGACY_BEARER', 'PUBLIC_KEY'])
export const credentialStatus = pgEnum('CredentialStatus', [
  'PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED',
])
export const channelType = pgEnum('ChannelType', ['EMAIL', 'PUSHOVER', 'WEBHOOK'])
export const channelStatus = pgEnum('ChannelStatus', ['ACTIVE', 'DISABLED', 'UNHEALTHY'])
export const deliveryStatus = pgEnum('DeliveryStatus', [
  'PENDING', 'LEASED', 'RETRYING', 'SENT', 'FAILED', 'CANCELLED',
])
```

Extend `source_apps` with `enrollmentStatus`, `credentialMode`, `technicalGroupId`, `lastAuthenticatedAt`, and `lastIngestedAt`. Extend `feedback_tickets` with `triage` JSON using:

```ts
export interface FeedbackTriage {
  ownerRef: string
  ownerName: string | null
  escalatedAt: string
}
```

Reorder declarations so `support_users` and `support_groups` are defined before `source_apps`; this makes the new nullable `technicalGroupId` foreign key explicit without a forward-reference workaround. Keep it nullable through legacy migration, while application mutations require a group for every newly enrolled app.

Create the approved tables with these uniqueness rules:

```text
app_enrollment_grants: unique token_digest
app_credentials: unique public_key_thumbprint
service_assertion_replays: unique credential_id + assertion_jti
ingest_receipts: unique source_app_id + idempotency_key
escalation_events: unique ticket_id + generation and unique event_key
routing_incidents: unique escalation_event_id
support_groups: at most one row where is_central_fallback = true
support_group_members: unique group_id + support_user_id
notification_channels: unique group_id + name
app_notification_policies: unique source_app_id
delivery_outbox: unique event_key + target_key + generation
delivery_attempts: unique outbox_id + ordinal
audit_events: append-only, no update path
service_rate_limit_buckets: unique scope + subject + window_start
support_settings: unique key; `legacy_pushover_bridge_retired_at` is the cutover marker
```

Foreign keys must cascade only for true owned children. Audit rows and delivery attempts retain their redacted subject identifiers if the source entity is removed.

The outbox stores `target_key` (required), `channel_id` (nullable foreign key), `channel_type`, and `config_source`. Database-backed targets use `channel:<id>` plus `DATABASE`; the migration-only Pushover bridge uses `legacy:central-pushover` plus `LEGACY_ENV` and never stores provider credentials.

Add immutable `escalation_events` rows between tickets and delivery targets. Each material ticket change creates one event with its canonical minimized payload and monotonically increasing ticket generation; every outbox row references that event. Application code exposes insert and read operations only, never update or delete.

- [ ] **Step 4: Implement the migration runner**

```ts
// lib/db/migrations.ts
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

export async function applyMigration({
  name,
  sqlText,
  pool,
}: {
  name: string
  sqlText: string
  pool: Pool
}): Promise<'applied' | 'already-applied'> {
  const checksum = createHash('sha256').update(sqlText).digest('hex')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtext('support-tower-migrations'))")
    await client.query(`create table if not exists support_schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`)
    const existing = await client.query<{ checksum: string }>(
      'select checksum from support_schema_migrations where name = $1',
      [name],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${name}`)
      }
      await client.query('commit')
      return 'already-applied'
    }
    await client.query(sqlText)
    await client.query(
      'insert into support_schema_migrations (name, checksum) values ($1, $2)',
      [name, checksum],
    )
    await client.query('commit')
    return 'applied'
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
```

The SQL migration must use additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, guarded enum creation, new tables, foreign keys, and indexes matching `lib/db/schema.ts`. It must not drop, rename, or rewrite existing ticket data.

Expand the integration fixture into a real upgrade rehearsal: create the exact current pre-overhaul schema, insert representative apps, users, tickets, and legacy configuration, apply the actual `drizzle/0001_support_portal_core.sql` twice, then assert row preservation, enum compatibility, foreign keys, required indexes, migration checksum behavior, and Drizzle/schema parity. A fresh-schema-only test is insufficient.

- [ ] **Step 5: Add and run migration commands**

Add scripts:

```json
{
  "db:migrate:support": "tsx scripts/apply-support-migrations.ts",
  "test:integration": "vitest run --config vitest.integration.config.ts"
}
```

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration -- tests/integration/schema-migration.test.ts
npm run typecheck
npm run lint
```

Expected: both migration behaviors pass, and schema types compile.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations.ts drizzle/0001_support_portal_core.sql scripts/apply-support-migrations.ts tests/integration/schema-migration.test.ts package.json package-lock.json
git commit -m "feat: add durable support portal schema"
```

### Task 3: Versioned Escalation Contract and Legacy Normalization

**Routing:** Terra, high.

**Files:**
- Create: `lib/escalations/contract.ts`
- Create: `lib/escalations/errors.ts`
- Create: `tests/unit/escalation-contract.test.ts`
- Modify: `lib/feedback/ingest.ts`

**Interfaces:**
- Consumes: existing `FeedbackIngestPayload` and status aliases.
- Produces: `EscalationCommand`, `escalationV1Schema`, `legacyPayloadToCommand(payload, authoritativeAppId)`, `canonicalEscalationDigest(command)`.

- [ ] **Step 1: Write failing contract tests**

```ts
it('maps FEATURE_REQUEST to the stored EVOLUTION kind', () => {
  const command = escalationV1Schema.parse(validV1)
  expect(command.kind).toBe('EVOLUTION')
})

it('does not accept application identity in a version 1 payload', () => {
  const parsed = escalationV1Schema.safeParse({ ...validV1, app: { slug: 'other' } })
  expect(parsed.success).toBe(false)
})

it('produces the same digest for objects with different key order', () => {
  expect(canonicalEscalationDigest(validCommand)).toBe(
    canonicalEscalationDigest(reorderedCommand),
  )
})
```

Expected breaks caught: trusting payload app identity, inconsistent duplicate detection, or failing classification compatibility.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/escalation-contract.test.ts`

Expected: FAIL because the contract module is absent.

- [ ] **Step 3: Implement the schemas and exact internal type**

```ts
export interface EscalationCommand {
  externalId: string
  kind: 'BUG' | 'EVOLUTION'
  status: FeedbackStatus
  priority: FeedbackPriority
  title: string
  description: string
  sourceUrl: string | null
  triage: {
    ownerRef: string
    ownerName: string | null
    escalatedAt: string
  }
  reporter: {
    name: string | null
    email: string | null
    sourceId: string | null
  }
  browserInfo: string | null
  markdownSpec: string | null
  transcript: Array<{ role: string; content: string }> | null
  remoteCreatedAt: string | null
  remoteUpdatedAt: string | null
  metadata: Record<string, unknown>
}
```

Use a strict Zod object, a 256 KB route limit, existing normalization helpers, and a stable recursive key sorter before SHA-256 hashing. Legacy payloads use `triage.ownerRef = 'legacy-source'`, nullable owner name, and `escalatedAt` from remote update time or receipt time.

- [ ] **Step 4: Run GREEN and regression tests**

Run:

```bash
npx vitest run tests/unit/escalation-contract.test.ts tests/unit/feedback-ingest.test.ts
npm run typecheck
```

Expected: contract and existing ingest normalization tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/escalations/contract.ts lib/escalations/errors.ts tests/unit/escalation-contract.test.ts lib/feedback/ingest.ts
git commit -m "feat: define versioned escalation contract"
```

### Task 4: Pure Routing Policy and Minimized Alert Event

**Routing:** Terra, medium.

**Files:**
- Create: `lib/delivery/types.ts`
- Create: `lib/delivery/policy.ts`
- Create: `lib/delivery/render.ts`
- Create: `tests/unit/delivery-policy.test.ts`
- Create: `tests/unit/delivery-render.test.ts`

**Interfaces:**
- Consumes: `EscalationCommand`, app policy, app group channels, and central channels.
- Produces: `resolveDeliveryTargets(input): RoutingDecision`, `renderDeliveryEvent(input): DeliveryEvent`.

- [ ] **Step 1: Write failing routing tests**

```ts
const appEmail = {
  targetKey: 'channel:app-email',
  channelId: 'app-email',
  channelType: 'EMAIL' as const,
  configSource: 'DATABASE' as const,
  status: 'ACTIVE' as const,
  minimumPriority: 'MEDIUM' as const,
  includeReporterContext: false,
}
const centralPushover = {
  targetKey: 'channel:central-pushover',
  channelId: 'central-pushover',
  channelType: 'PUSHOVER' as const,
  configSource: 'DATABASE' as const,
  status: 'ACTIVE' as const,
  minimumPriority: 'LOW' as const,
  includeReporterContext: false,
}
const highFixture = {
  priority: 'HIGH' as const,
  appChannels: [appEmail],
  centralChannels: [centralPushover],
}
const urgentFixture = { ...highFixture, priority: 'URGENT' as const }
const disabledFixture = {
  ...highFixture,
  appChannels: [{ ...appEmail, status: 'DISABLED' as const }],
}

it('routes a high-priority escalation to the app group only', () => {
  expect(resolveDeliveryTargets(highFixture).targets.map((target) => target.channelId)).toEqual([
    'app-email',
  ])
})

it('copies urgent escalations to the central fallback without duplicates', () => {
  expect(resolveDeliveryTargets(urgentFixture).targets.map((target) => target.channelId)).toEqual([
    'app-email',
    'central-pushover',
  ])
})

it('uses central fallback when every app channel is disabled', () => {
  expect(resolveDeliveryTargets(disabledFixture).targets.map((target) => target.channelId)).toEqual([
    'central-pushover',
  ])
})

it('returns an explicit unroutable incident when no valid target exists', () => {
  expect(resolveDeliveryTargets({
    priority: 'HIGH',
    appChannels: [],
    centralChannels: [],
  })).toEqual({
    targets: [],
    incident: { code: 'NO_VALID_DELIVERY_TARGET' },
  })
})
```

- [ ] **Step 2: Write the data-minimization test**

```ts
const renderFixture = {
  ticketId: 'ticket-1',
  appName: 'Atelier Planning',
  kind: 'BUG' as const,
  priority: 'HIGH' as const,
  title: 'Cannot publish a schedule',
  description: 'private diagnostic description',
  portalUrl: 'https://support.example.test/feedback/ticket-1',
  reporter: { name: 'Élodie Martin', email: 'reporter@example.test' },
  includeReporterContext: false,
}

it('excludes reporter and description from default alert content', () => {
  const event = renderDeliveryEvent(renderFixture)
  expect(JSON.stringify(event)).not.toContain('reporter@example.test')
  expect(JSON.stringify(event)).not.toContain('private diagnostic description')
  expect(event).toMatchObject({
    appName: 'Atelier Planning',
    priority: 'HIGH',
    title: 'Cannot publish a schedule',
  })
})
```

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/delivery-policy.test.ts tests/unit/delivery-render.test.ts`

Expected: FAIL because the routing modules do not exist.

- [ ] **Step 4: Implement routing as pure functions**

```ts
export type DeliveryChannelType = 'EMAIL' | 'PUSHOVER' | 'WEBHOOK'

export type ChannelConfig =
  | { type: 'EMAIL'; to: string[] }
  | { type: 'PUSHOVER'; appToken: string; userKey: string }
  | { type: 'WEBHOOK'; url: string; signingSecret: string }

export interface DeliveryTarget {
  targetKey: string
  channelId: string | null
  channelType: DeliveryChannelType
  configSource: 'DATABASE' | 'LEGACY_ENV'
  includeReporterContext: boolean
}

export interface RoutableChannel extends DeliveryTarget {
  status: 'ACTIVE' | 'DISABLED' | 'UNHEALTHY'
  minimumPriority: FeedbackPriority
}

export interface RoutingInput {
  priority: FeedbackPriority
  appChannels: RoutableChannel[]
  centralChannels: RoutableChannel[]
}

export interface RoutingDecision {
  targets: DeliveryTarget[]
  incident: null | { code: 'NO_VALID_DELIVERY_TARGET' }
}

export interface DeliveryEvent {
  ticketId: string
  appName: string
  kind: 'BUG' | 'EVOLUTION'
  priority: FeedbackPriority
  title: string
  portalUrl: string
  reporterContext?: { name: string | null; email: string | null }
}

export function resolveDeliveryTargets(input: RoutingInput): RoutingDecision {
  const appTargets = input.appChannels.filter(
    (channel) => channel.status === 'ACTIVE' &&
      priorityRank(input.priority) >= priorityRank(channel.minimumPriority),
  )
  const needsCentral = input.priority === 'URGENT' || appTargets.length === 0
  const targets = needsCentral ? [...appTargets, ...input.centralChannels] : appTargets
  const deduped = dedupeByTargetKey(targets)
  return {
    targets: deduped,
    incident: deduped.length === 0 ? { code: 'NO_VALID_DELIVERY_TARGET' } : null,
  }
}
```

Render authenticated portal links only. Include reporter context only when the target explicitly opts in.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/delivery-policy.test.ts tests/unit/delivery-render.test.ts`

```bash
git add lib/delivery/types.ts lib/delivery/policy.ts lib/delivery/render.ts tests/unit/delivery-policy.test.ts tests/unit/delivery-render.test.ts
git commit -m "feat: add escalation delivery policy"
```

### Task 5: Transactional Intake, Idempotency, and Outbox Creation

**Routing:** Terra, high. Sol reviews Tasks 1 through 5 before Milestone 1 continues.

**Files:**
- Create: `lib/escalations/repository.ts`
- Create: `lib/escalations/intake.ts`
- Create: `tests/integration/escalation-intake.test.ts`

**Interfaces:**
- Consumes: `EscalationCommand`, `resolveDeliveryTargets`, `getDb()` transaction.
- Produces: `acceptEscalation(input, deps?): Promise<IntakeResult>`.

```ts
export interface AcceptEscalationInput {
  appId: string
  credentialId: string | null
  idempotencyKey: string
  command: EscalationCommand
  receivedAt?: Date
}

export interface IntakeResult {
  appId: string
  ticketId: string
  result: 'created' | 'updated' | 'duplicate'
  acceptedAt: Date
}
```

- [ ] **Step 1: Write the atomicity and duplicate tests**

```ts
it('rolls back ticket and receipt when outbox creation fails', async () => {
  await expect(
    acceptEscalation(input, {
      ...testDependencies,
      resolveTargets: async () => ({
        targets: [{
          targetKey: 'channel:missing',
          channelId: 'missing',
          channelType: 'EMAIL',
          configSource: 'DATABASE',
          includeReporterContext: false,
        }],
        incident: null,
      }),
    }),
  ).rejects.toThrow()
  expect(await countTickets(input.appId)).toBe(0)
  expect(await countReceipts(input.appId)).toBe(0)
})

it('returns the original result for the same idempotency key and digest', async () => {
  const first = await acceptEscalation(input)
  const second = await acceptEscalation(input)
  expect(second).toEqual({ ...first, result: 'duplicate' })
  expect(await countOutboxRows(first.ticketId)).toBe(1)
})

it('rejects a changed payload under the same idempotency key', async () => {
  await acceptEscalation(input)
  await expect(
    acceptEscalation({ ...input, command: { ...input.command, title: 'Changed' } }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
})
```

- [ ] **Step 2: Add the concurrency test**

Run ten simultaneous calls with the same `(appId, idempotencyKey)` and assert one ticket, one receipt, and one event-target outbox row.

- [ ] **Step 3: Run RED**

Run: `TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration -- tests/integration/escalation-intake.test.ts`

Expected: FAIL because transactional intake is absent.

- [ ] **Step 4: Implement transaction orchestration**

```ts
export interface IntakeDependencies {
  db: Db
  resolveTargets(
    tx: DbTransaction,
    appId: string,
    priority: FeedbackPriority,
  ): Promise<RoutingDecision>
}

export async function acceptEscalation(
  input: AcceptEscalationInput,
  deps: IntakeDependencies = {
    db: getDb(),
    resolveTargets: resolveTargetsFromDb,
  },
): Promise<IntakeResult> {
  const digest = canonicalEscalationDigest(input.command)
  const acceptedAt = input.receivedAt ?? new Date()

  return deps.db.transaction(async (tx) => {
    const receipt = await claimReceipt(tx, input, digest, acceptedAt)
    if (receipt.kind === 'duplicate') return receipt.result
    if (receipt.kind === 'conflict') throw new IntakeError('IDEMPOTENCY_CONFLICT')

    await lockTicketIdentity(tx, input.appId, input.command.externalId)
    const ticket = await upsertEscalationTicket(tx, input, acceptedAt)
    const routing = ticket.materialChange
      ? await deps.resolveTargets(tx, input.appId, input.command.priority)
      : { targets: [], incident: null }
    const event = ticket.materialChange
      ? await insertEscalationEvent(tx, ticket, input.command, acceptedAt)
      : null
    if (event) {
      await insertDeliveryOutbox(tx, event, routing.targets, acceptedAt)
      await insertRoutingIncident(tx, event, routing.incident, acceptedAt)
    }
    await appendAuditEvent(tx, buildAcceptedAudit(input, ticket, acceptedAt))
    return finalizeReceipt(tx, receipt.id, ticket, acceptedAt)
  })
}
```

`lockTicketIdentity` uses a transaction-scoped advisory lock derived from app ID plus external ID. Receipt claims use `INSERT ... ON CONFLICT DO NOTHING` followed by a locked read. Outbox uniqueness is event key, target key, and generation. Persist `targetKey`, nullable `channelId`, `channelType`, and `configSource` on each outbox row so legacy environment-backed Pushover remains durable before DB channel backfill, while all newly configured channels use a real `channelId`.

Implement the minimal transaction-aware `resolveTargetsFromDb` reader in `lib/escalations/repository.ts` in this task; it reads app ownership, policy thresholds, channel health metadata, and central fallback metadata without decrypting provider configuration. Task 9 later adds mutation repositories and richer read models. Add an integration test that invokes `acceptEscalation(input)` with its real default dependencies so compilation and runtime cannot be masked by injected doubles.

When routing has no valid app or central target, persist one visible `routing_incidents` row referencing the immutable escalation event in the same transaction. The escalation remains accepted, but Deliveries exposes the terminal incident and administrators can repair policy and replay it later.

- [ ] **Step 5: Run GREEN and the mutation checks**

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration -- tests/integration/escalation-intake.test.ts
npm run test:run
npm run typecheck
```

Manually mutate the outbox insert out of the transaction, confirm the atomicity test fails, restore it, and rerun GREEN.

- [ ] **Step 6: Commit**

```bash
git add lib/escalations/repository.ts lib/escalations/intake.ts tests/integration/escalation-intake.test.ts
git commit -m "feat: persist escalations and alerts atomically"
```

### Task 6: Delivery Adapters, Leases, Retries, and Recovery Cron

**Routing:** Terra, high.

**Files:**
- Create: `lib/delivery/repository.ts`
- Create: `lib/delivery/worker.ts`
- Create: `lib/delivery/adapters/email.ts`
- Create: `lib/delivery/adapters/pushover.ts`
- Create: `lib/delivery/adapters/webhook.ts`
- Create: `lib/delivery/webhook-target.ts`
- Create: `lib/delivery/dispatch.ts`
- Create: `app/api/cron/deliver-alerts/route.ts`
- Create: `tests/unit/delivery-adapters.test.ts`
- Create: `tests/unit/webhook-target.test.ts`
- Create: `tests/integration/delivery-worker.test.ts`
- Modify: `vercel.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: outbox rows and channel configuration.
- Produces: `runDeliverySweep({ limit, now, workerId }): Promise<DeliverySweepResult>`, `drainImmediateDeliveries({ batchSize, maxJobs, maxDurationMs })`, `scheduleDeliveryWakeup()`, and `DeliveryAdapter.send()`.

- [ ] **Step 1: Write failing adapter boundary tests**

```ts
it('signs webhook timestamp and exact body bytes', async () => {
  const request = await captureWebhookRequest({
    secret: 'test-secret',
    timestamp: 1_786_538_400,
    rawBody: '{"title":"Cannot publish"}',
  })
  expect(request.headers['x-support-timestamp']).toBe('1786538400')
  expect(request.headers['x-support-signature']).toBe(
    'v1=71cd200c2c2f05c680458703bf7f9b239af1f20c0d072b55074af75749c9a435',
  )
})

it('does not send reporter context through the default Pushover event', async () => {
  const request = await capturePushoverRequest(defaultEvent)
  expect(request.body).not.toContain('reporter@example.test')
})

it('rejects private, loopback, link-local, credentialed, non-HTTPS, and redirecting webhook targets', async () => {
  await expectWebhookTargetRejected(webhookSsrfCases)
})
```

- [ ] **Step 2: Write failing lease and retry integration tests**

Cover two workers claiming concurrently, a network failure becoming `RETRYING`, a retryable 429 honoring bounded `Retry-After`, a permanent 400 becoming `FAILED`, lease expiry recovery, a successful attempt becoming `SENT` with provider message ID, and a 500-row immediate drain beginning every healthy target inside 60 seconds under the representative test provider.

- [ ] **Step 3: Run RED**

Run:

```bash
npx vitest run tests/unit/delivery-adapters.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration -- tests/integration/delivery-worker.test.ts
```

- [ ] **Step 4: Implement the adapter contract and retry schedule**

```ts
export interface DeliveryAdapter {
  send(input: {
    event: DeliveryEvent
    config: ChannelConfig
    idempotencyKey: string
    fetchImpl?: typeof fetch
  }): Promise<{
    result: 'sent' | 'retryable' | 'permanent'
    providerStatus: number | null
    providerMessageId: string | null
    retryAfterMs: number | null
    sanitizedError: string | null
  }>
}

export const retryDelaysMs = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
] as const
```

Jitter is deterministic from outbox ID in tests and bounded to ±10 percent in production.

At this task boundary, claim only `LEGACY_ENV` jobs. Accept only the reserved `legacy:central-pushover` target and read the existing Pushover environment variables; never serialize provider secrets into the outbox. Leave `DATABASE` jobs pending with a visible `CONFIGURATION_NOT_READY` reason until Task 8 supplies decryption and enables them. Task 10 retires the bridge by backfilling an encrypted database channel and switching routing policy atomically.

For generic webhooks, require HTTPS, forbid URL credentials, resolve all A/AAAA addresses, and reject private, loopback, link-local, multicast, documentation, carrier-grade NAT, and reserved IPv4/IPv6 ranges. Send with redirects disabled. Use an `undici` dispatcher with a custom lookup that returns only the already validated addresses while preserving TLS SNI/hostname verification, preventing a second untrusted DNS answer between validation and connection. Revalidate any future redirect before following it. Unit tests cover direct and encoded IPs, IPv4-mapped IPv6, redirect-to-private, mixed public/private DNS answers, and a DNS-rebinding double that changes its answer after validation.

- [ ] **Step 5: Implement lease claiming and route**

Use one SQL statement with a CTE, `FOR UPDATE SKIP LOCKED`, lease owner, and lease expiry. `drainImmediateDeliveries` processes batches of 100 until no immediately eligible work remains, 500 jobs have begun, or 45 seconds elapse. `scheduleDeliveryWakeup` uses Next.js `after()` only after the intake transaction commits; the HTTP response does not wait for providers. The cron route requires the existing `CRON_SECRET`, invokes the same bounded drain as recovery-only infrastructure, and returns counts only.

Add:

```json
{
  "path": "/api/cron/deliver-alerts",
  "schedule": "* * * * *"
}
```

- [ ] **Step 6: Run GREEN and commit**

Run all focused tests, then `npm run test:run`, `npm run typecheck`, and `npm run lint`.

```bash
git add lib/delivery app/api/cron/deliver-alerts/route.ts tests/unit/delivery-adapters.test.ts tests/unit/webhook-target.test.ts tests/integration/delivery-worker.test.ts vercel.json package.json package-lock.json
git commit -m "feat: deliver alerts with durable retries"
```

### Task 7: Route Every Legacy Intake Path Through the Durable Core

**Routing:** Terra, high.

**Files:**
- Modify: `app/api/feedback/ingest/route.ts`
- Modify: `lib/feedback/source-pull.ts`
- Modify: `app/api/cron/sync-source-apps/route.ts`
- Modify: `app/api/feedback/[id]/refresh/route.ts`
- Modify: `lib/notifications/pushover.ts`
- Modify: `tests/unit/source-pull.test.ts`
- Modify: `tests/unit/sync-source-apps.test.ts`
- Create: `tests/unit/legacy-ingest-route.test.ts`
- Create: `tests/integration/legacy-intake-paths.test.ts`
- Modify: `scenarios/control-tower/SCN-001-ingest-feedback.md`
- Modify: `scenarios/control-tower/SCN-003-cron-sync-source-apps.md`
- Modify: `e2e/scenarios/control-tower/SCN-001.spec.ts`
- Modify: `e2e/scenarios/control-tower/SCN-003.spec.ts`

**Interfaces:**
- Consumes: Task 5 `acceptEscalation()`.
- Produces: `acceptLegacyPayload({ payload, authoritativeAppSlug, idempotencyKey }): Promise<IntakeResult>` and the reserved `legacy:central-pushover` delivery target while the legacy environment configuration is present.

- [ ] **Step 1: Write failing regression tests for the reported bugs**

```ts
it('creates delivery work for a new ticket discovered by full pull', async () => {
  await pullSourceApp({ appSlug: 'casal-track', ...fixtureDeps })
  expect(await countOutboxForExternalId('ct_42')).toBe(1)
})

it('rejects a pull payload whose app slug differs from configured app', async () => {
  const result = await pullSourceApp({ appSlug: 'casal-track', ...mismatchDeps })
  expect(result.errors).toEqual(['ct_42: source app identity mismatch'])
})

it('does not call Pushover inline from the legacy POST route', async () => {
  const response = await POST(validLegacyRequest)
  expect(response.status).toBe(201)
  expect(inlinePushoverTransport).not.toHaveBeenCalled()
})

it('schedules the post-commit delivery wakeup only after acceptance succeeds', async () => {
  await POST(validLegacyRequest)
  expect(scheduleDeliveryWakeup).toHaveBeenCalledOnce()
  await expect(POST(failingPersistenceRequest)).rejects.toThrow()
  expect(scheduleDeliveryWakeup).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run RED**

Run focused unit and integration files. Confirm the pull-created outbox assertion fails against current behavior.

- [ ] **Step 3: Implement the legacy adapter**

Use the configured slug as authority. Prefer a provided `Idempotency-Key`; otherwise derive `legacy:<externalId>:<canonicalDigest>`. Map result values back to the current `{ appId, ticketId, created }` response during compatibility. When the current Pushover environment is configured and no database policy exists yet, resolve the reserved target as `{ targetKey: 'legacy:central-pushover', channelId: null, channelType: 'PUSHOVER', configSource: 'LEGACY_ENV' }`; this keeps alerts durable during migration without persisting secrets.

Change `pullSourceApp` injection from `ingest(payload)` to:

```ts
accept(payload: FeedbackIngestPayload, authoritativeAppSlug: string): Promise<IngestResult>
```

Both scheduled and manual pull pass their configured slug. After each successful committed acceptance, call `scheduleDeliveryWakeup`; never schedule it from inside the transaction or after a failed acceptance. Remove `notifyTicketCreated` from the route. Retain Pushover transport helpers for the new adapter, but remove the orchestration function after no callers remain.

- [ ] **Step 4: Reconcile scenario text and hashes**

SCN-001 must name per-app legacy tokens and durable outbox acceptance. SCN-003 must describe full sync and new-ticket alert creation. Recompute body hashes with the existing scenario drift utility and update the linked spec markers.

- [ ] **Step 5: Run GREEN and full Milestone 1 gate**

Run:

```bash
npm run test:run
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration
npm run scenario:check
npm run typecheck
npm run lint
npm run build
```

Expected: no failures, direct and pull paths create durable delivery work, and no provider call occurs inline.

- [ ] **Step 6: Commit**

```bash
git add app/api/feedback/ingest/route.ts lib/feedback/source-pull.ts app/api/cron/sync-source-apps/route.ts 'app/api/feedback/[id]/refresh/route.ts' lib/notifications/pushover.ts tests scenarios e2e/scenarios/control-tower
git commit -m "fix: unify legacy feedback and alert delivery"
```

---

## Milestone 2: Ownership, Channels, and Delivery Operations

### Task 8: Encrypt Channel Configuration with Versioned Envelope Keys

**Routing:** Terra, high. Sol reviews secret handling.

**Files:**
- Create: `lib/routing/crypto.ts`
- Create: `lib/routing/channel-schemas.ts`
- Create: `tests/unit/routing-crypto.test.ts`
- Modify: `lib/delivery/worker.ts`
- Modify: `tests/integration/delivery-worker.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `encryptChannelConfig(config, context, keyring, nonce?): EncryptedConfig`, `decryptChannelConfig(record, context, keyring): ChannelConfig`.

- [ ] **Step 1: Write failing known-answer and tamper tests**

Use key hex `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`, nonce hex `000102030405060708090a0b`, channel `channel-1`, type `EMAIL`, and canonical plaintext `{"to":["alerts@example.test"]}`. Assert ciphertext `PCCidOffmTnsLfL5xZo4CPu36kScHnEIXRSRp0AU`, auth tag `zBJO0wTXPd4BC14JOM/HQA==`, successful round trip, failure after one-byte ciphertext mutation, failure when the channel/type AAD changes, and failure for an unknown key version.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/routing-crypto.test.ts`

- [ ] **Step 3: Implement AES-256-GCM records**

```ts
export interface EncryptedConfig {
  keyVersion: string
  nonce: string
  ciphertext: string
  authTag: string
}

export interface ChannelKeyring {
  activeVersion: string
  keys: Record<string, Buffer>
}

export interface ChannelCryptoContext {
  channelId: string
  type: DeliveryChannelType
}
```

Reuse the `ChannelConfig` discriminated union from Task 4; the crypto layer validates and encrypts that adapter-facing type rather than defining a second contract.

Parse `SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON` as `{ "active": "v1", "keys": { "v1": "base64-32-byte-key" } }`. Validate exact key length with Zod. Use `support-tower-channel:<channelId>:<type>:<keyVersion>` as AES-GCM additional authenticated data. Never log input config or decrypted output.

Validate channel configuration with strict per-adapter Zod schemas; webhook configuration must also pass Task 6's SSRF-safe target parser. Wire the worker to load and decrypt `DATABASE` channel records only now, then remove the temporary `CONFIGURATION_NOT_READY` claim exclusion. Extend the worker integration suite to prove database-backed email, Pushover, and webhook jobs dispatch and that tampered/unknown-key records become visible non-retryable configuration failures without exposing ciphertext or plaintext.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run tests/unit/routing-crypto.test.ts
git add lib/routing/crypto.ts lib/routing/channel-schemas.ts tests/unit/routing-crypto.test.ts .env.example
git commit -m "feat: encrypt notification channel settings"
```

### Task 9: Group, Channel, Policy, and Audit Repositories

**Routing:** Terra, high.

**Files:**
- Create: `lib/routing/groups.ts`
- Create: `lib/routing/channels.ts`
- Create: `lib/routing/policies.ts`
- Create: `lib/audit/events.ts`
- Create: `tests/integration/routing-repositories.test.ts`

**Interfaces:**
- Consumes: Task 8 encrypted configuration.
- Produces: `createGroup`, `setGroupMembers`, `createChannel`, `updateChannel`, `setAppPolicy`, `getRoutingContext`, `appendAuditEvent`.

- [ ] **Step 1: Write failing repository tests**

Cover one central fallback only, duplicate membership rejection, redacted channel reads, encrypted database values, app policy replacement in one transaction, and immutable audit rows.

- [ ] **Step 2: Run RED**

Run the single integration test file.

- [ ] **Step 3: Implement repositories with explicit public types**

```ts
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
```

Mutation functions require `actorId` and `correlationId` and append audit events in the same transaction.

- [ ] **Step 4: Run GREEN and commit**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration -- tests/integration/routing-repositories.test.ts
git add lib/routing lib/audit tests/integration/routing-repositories.test.ts
git commit -m "feat: manage support routing and audit"
```

### Task 10: Backfill Central Fallback and Legacy Pushover Channel

**Routing:** Terra, medium.

**Files:**
- Create: `scripts/backfill-support-routing.ts`
- Create: `tests/integration/routing-backfill.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing source apps and optional Pushover env configuration.
- Produces: idempotent `backfillSupportRouting({ db, env, actorId }): Promise<BackfillSummary>`.

- [ ] **Step 1: Write failing idempotent and racing-cutover tests**

Seed two apps, run twice, and assert one central group, one policy per app, no duplicate channel, and exact second-run counts of zero created rows. Race intake against the backfill transaction and assert each created event has exactly one target generation: either `legacy:central-pushover` or the database channel, never both and never neither.

- [ ] **Step 2: Run RED**

Run the integration test file.

- [ ] **Step 3: Implement exact backfill rules**

- Create `Central support` with `isCentralFallback = true` when absent.
- If both current Pushover env values exist, create one encrypted `Central Pushover` channel.
- Assign every unassigned app to the central group temporarily.
- Mark current apps `credentialMode = LEGACY_BEARER`.
- Append one audit event per changed app without storing env secrets.
- In the same serializable transaction, create and encrypt the database channel, install policies, set a database `legacyBridgeRetiredAt` flag, and stop future resolution of `LEGACY_ENV`. Acquire the same routing advisory lock that intake's minimal resolver uses, so cutover is atomic relative to target selection.

- [ ] **Step 4: Run GREEN and commit**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration -- tests/integration/routing-backfill.test.ts
git add scripts/backfill-support-routing.ts tests/integration/routing-backfill.test.ts package.json package-lock.json
git commit -m "feat: backfill central support routing"
```

### Task 11: Admin-Only Routing Mutations and Delivery Retry Action

**Routing:** Terra, high.

**Files:**
- Create: `app/teams/actions.ts`
- Create: `app/apps/actions.ts`
- Create: `app/deliveries/actions.ts`
- Create: `tests/unit/routing-actions.test.ts`
- Create: `tests/integration/delivery-retry.test.ts`

**Interfaces:**
- Consumes: `requireAdminUser`, routing repositories, delivery repository.
- Produces: typed server-action states with `{ status, message, fieldErrors }`.

- [ ] **Step 1: Write failing authorization and retry tests**

Assert SUPPORT cannot mutate group/channel/policy, ADMIN can, retrying a failed delivery creates generation `n + 1` rather than modifying the terminal row, and a sent delivery cannot be retried.

- [ ] **Step 2: Run RED**

Run focused unit and integration tests.

- [ ] **Step 3: Implement typed action results**

```ts
export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }
```

Use factual messages: `Technical group created`, `Alert policy updated`, `Delivery queued`. Map Zod errors to visible fields. Revalidate exact affected routes.

- [ ] **Step 4: Run GREEN and Milestone 2 gate**

Run unit, integration, typecheck, lint, and build.

- [ ] **Step 5: Commit**

```bash
git add app/teams/actions.ts app/apps/actions.ts app/deliveries/actions.ts tests/unit/routing-actions.test.ts tests/integration/delivery-retry.test.ts
git commit -m "feat: add routing administration actions"
```

---

## Milestone 3: Public-Key Enrollment and Service Authentication

### Task 12: Invitation Lifecycle and Ed25519 Public-Key Validation

**Routing:** Terra, high. Sol reviews crypto choices.

**Files:**
- Create: `lib/service-auth/invitations.ts`
- Create: `lib/service-auth/jwk.ts`
- Create: `tests/unit/service-invitations.test.ts`
- Create: `tests/unit/service-jwk.test.ts`
- Create: `tests/integration/service-invitations.test.ts`

**Interfaces:**
- Produces: `createInvitation`, `consumeInvitation`, `revokeInvitation`, `validateEd25519PublicJwk`, `publicJwkThumbprint`.

- [ ] **Step 1: Write failing invitation tests**

Assert 32 random bytes, one-time display result, SHA-256 digest persistence, 30-minute expiry, constant-time digest comparison, atomic single consumption under concurrency, and revocation.

- [ ] **Step 2: Write failing JWK tests**

Accept only `{ kty: 'OKP', crv: 'Ed25519', x }`, reject private `d`, reject wrong curve, and reject invalid base64url length. For `{ "crv": "Ed25519", "kty": "OKP", "x": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" }`, assert the literal RFC 7638 thumbprint `P7IdLIpiTZiFaIoOSqbX3JrSyps3hvZ4Y2SieP96XIY`.

- [ ] **Step 3: Run RED**

Run the three focused test files.

- [ ] **Step 4: Implement invitation and JWK helpers**

```ts
export interface CreatedInvitation {
  id: string
  secret: string
  expiresAt: Date
}

export function invitationDigest(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}
```

Store only digest and an eight-character non-secret prefix. Consume with a locked row and one update requiring `consumedAt IS NULL`, `revokedAt IS NULL`, and `expiresAt > now`.

- [ ] **Step 5: Run GREEN and commit**

```bash
git add lib/service-auth/invitations.ts lib/service-auth/jwk.ts tests/unit/service-invitations.test.ts tests/unit/service-jwk.test.ts tests/integration/service-invitations.test.ts
git commit -m "feat: add secure application invitations"
```

### Task 13: Client Assertions, Replay Protection, and Access Tokens

**Routing:** Terra, high. Sol security review required before Task 14.

**Files:**
- Create: `lib/service-auth/assertions.ts`
- Create: `lib/service-auth/access-tokens.ts`
- Create: `lib/service-auth/credentials.ts`
- Create: `scripts/generate-service-signing-key.ts`
- Create: `tests/unit/service-assertions.test.ts`
- Create: `tests/unit/service-access-tokens.test.ts`
- Create: `tests/integration/service-replay.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `verifyClientAssertion`, `issueServiceAccessToken`, `verifyServiceAccessToken`, `getActiveCredential`, and a signing-key script.

- [ ] **Step 1: Write failing claim and signature tests**

Use an in-test Ed25519 key pair. Cover correct signature, wrong key, `iss !== sub`, wrong audience, expiration over 60 seconds, future `iat`, missing `jti`, unknown `kid`, revoked credential, and replayed `jti`.

- [ ] **Step 2: Write failing access-token tests**

Assert exact issuer, audience, app ID, credential ID, scope, five-minute maximum lifetime, portal signature, and immediate rejection after credential revocation.

- [ ] **Step 3: Run RED**

Run focused unit and integration tests.

- [ ] **Step 4: Implement JOSE boundaries**

```ts
export interface ServicePrincipal {
  appId: string
  credentialId: string
  scopes: Array<'escalations:write' | 'credentials:rotate'>
}
```

Use `jose` `compactVerify` or `jwtVerify` with explicit `algorithms: ['EdDSA']`, exact issuer and audience, five-second clock tolerance, and maximum token age. Load the portal private JWK from `SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK`; expose only the derived public JWK internally.

The generator prints private and public JWK JSON to separate explicitly labeled stdout lines and never writes files.

- [ ] **Step 5: Run GREEN and commit**

```bash
git add lib/service-auth/assertions.ts lib/service-auth/access-tokens.ts lib/service-auth/credentials.ts scripts/generate-service-signing-key.ts tests/unit/service-assertions.test.ts tests/unit/service-access-tokens.test.ts tests/integration/service-replay.test.ts .env.example
git commit -m "feat: issue scoped application access tokens"
```

### Task 14: Database-Backed Service Rate Limits

**Routing:** Terra, medium.

**Files:**
- Create: `lib/service-auth/rate-limit.ts`
- Create: `tests/integration/service-rate-limit.test.ts`

**Interfaces:**
- Produces: `consumeServiceRateLimit({ tx, scope, subject, limit, windowMs, now }): RateLimitDecision`, `consumeRequiredLimits(tx, limits)`, and `getTrustedClientIp(request)`.

- [ ] **Step 1: Write failing boundary tests**

Assert the final allowed request succeeds, the next is denied with exact `retryAfterSeconds`, a new window resets, subjects are isolated, and concurrent requests cannot exceed the limit. Independently prove enrollment's per-invitation and per-IP limits, token's per-credential limit/burst, intake's per-app limit, and that a spoofed client-supplied `X-Forwarded-For` cannot rotate the trusted IP subject.

- [ ] **Step 2: Run RED**

Run the integration file.

- [ ] **Step 3: Implement atomic bucket upsert**

Use one `INSERT ... ON CONFLICT ... DO UPDATE` that increments only within the window and returns the count. Defaults:

```ts
export const serviceRateLimits = {
  enrollmentInvitation: { limit: 10, windowMs: 60 * 60_000 },
  enrollmentIp: { limit: 30, windowMs: 60 * 60_000 },
  tokenCredential: { limit: 60, burst: 10, windowMs: 60_000 },
  ingestApp: { limit: 120, windowMs: 60_000 },
} as const
```

Consume all limits required by a route in the same database transaction as replay/grant state changes, so concurrency cannot spend one dimension without the other. In production, derive the subject only from the deployment platform's canonical forwarded-client-IP header and reject the request if it is missing or malformed; ignore ordinary client-controlled forwarding headers. Keep the header adapter injectable so local tests use an explicit remote address.

- [ ] **Step 4: Run GREEN and commit**

```bash
git add lib/service-auth/rate-limit.ts tests/integration/service-rate-limit.test.ts
git commit -m "feat: rate limit application authentication"
```

### Task 15: Enrollment, Token, and Version 1 Intake Routes

**Routing:** Terra, high.

**Files:**
- Create: `lib/service-auth/guards.ts`
- Create: `app/api/v1/enrollments/exchange/route.ts`
- Create: `app/api/v1/service-tokens/route.ts`
- Create: `app/api/v1/escalations/route.ts`
- Create: `tests/unit/service-routes.test.ts`
- Create: `tests/integration/versioned-intake.test.ts`

**Interfaces:**
- Consumes: Tasks 12 through 14 and `acceptEscalation`.
- Produces: approved JSON endpoint contracts and stable public errors.

- [ ] **Step 1: Write failing route contract tests**

Cover 201 invitation exchange, reused invitation 401, valid service token response, replayed assertion 401, valid escalation 201, duplicate 200, conflict 409, oversized 413, each independent rate limit returning 429 with `Retry-After`, revoked token 401, and persistence failure 503.

Add concurrent invitation-exchange integration tests plus injected failures after credential creation and audit insertion. Grant validation/consumption, credential creation, app activation, rate-limit spending, and audit append must be one transaction: exactly one concurrent exchange succeeds, and every failure leaves an unconsumed grant, no credential, no activation, and no partial audit state.

- [ ] **Step 2: Run RED**

Run focused unit and integration tests.

- [ ] **Step 3: Implement stable public errors**

```ts
export function publicError(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  headers?: HeadersInit,
) {
  return NextResponse.json(
    { error: { code, message, correlationId } },
    { status, headers },
  )
}
```

Read request bodies with a byte limit before JSON parsing. Never echo assertions, invitation secrets, access tokens, or provider errors.

- [ ] **Step 4: Bind identity from token only**

The v1 route calls:

```ts
const principal = await requireServicePrincipal(request, ['escalations:write'])
const result = await acceptEscalation({
  appId: principal.appId,
  credentialId: principal.credentialId,
  idempotencyKey: requireIdempotencyKey(request.headers),
  command: escalationV1Schema.parse(body),
})
scheduleDeliveryWakeup()
return result
```

Schedule the delivery wakeup only after `acceptEscalation` commits. Bind invitation throttling to both grant digest and trusted client IP, token throttling to credential, and intake throttling to token-derived app identity; never accept an app/rate-limit subject from request JSON.

- [ ] **Step 5: Run GREEN and commit**

Run route tests, all unit tests, integration tests, typecheck, and lint.

```bash
git add lib/service-auth/guards.ts app/api/v1 tests/unit/service-routes.test.ts tests/integration/versioned-intake.test.ts
git commit -m "feat: expose secure escalation connector API"
```

### Task 16: Overlapping Credential Rotation and Revocation

**Routing:** Terra, high. Sol security review required.

**Files:**
- Modify: `lib/service-auth/credentials.ts`
- Create: `app/api/v1/credentials/rotate/route.ts`
- Create: `app/api/v1/credentials/rotate/confirm/route.ts`
- Create: `tests/unit/credential-rotation-routes.test.ts`
- Create: `tests/integration/credential-rotation.test.ts`

**Interfaces:**
- Produces: `beginCredentialRotation`, `confirmCredentialRotation`, `revokeCredential`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover pending key creation, challenge digest storage, five-minute challenge expiry, proof with new key, activation, old-key overlap capped at seven days, automatic expiry, wrong proof, duplicate thumbprint, immediate revocation, and refusal to revoke the last active key unless the app is paused. Prove that a valid stolen access token without a fresh signature from the current active private key cannot begin rotation; reject reused nonce, wrong app/current credential, changed next-JWK body, and expired proof.

- [ ] **Step 2: Run RED**

Run focused unit and integration tests.

- [ ] **Step 3: Implement two-step rotation**

```ts
export interface RotationChallenge {
  credentialId: string
  challenge: string
  expiresAt: Date
}
```

Persist only challenge digest. Confirmation verifies an Ed25519 signature over `support-tower-rotation:<credentialId>:<challenge>`. Activate and shorten old-key validity in one transaction.

Beginning rotation requires both a scoped access token and a compact EdDSA proof signed by the currently active credential over canonical claims `{ appId, currentCredentialId, nextJwkThumbprint, nonce, iat, exp, aud: '/api/v1/credentials/rotate' }`. Cap proof age at 60 seconds, bind the thumbprint to the exact submitted next public JWK, and consume the nonce atomically through replay storage. A bearer token by itself is never sufficient. Confirmation still requires the pending new private key's challenge proof, giving explicit possession checks for both old and new keys.

- [ ] **Step 4: Run GREEN and Milestone 3 gate**

Run all unit, integration, route, typecheck, lint, and build commands.

- [ ] **Step 5: Commit**

```bash
git add lib/service-auth/credentials.ts app/api/v1/credentials/rotate tests/unit/credential-rotation-routes.test.ts tests/integration/credential-rotation.test.ts
git commit -m "feat: rotate application credentials without downtime"
```

---

## Milestone 4: Product Interface Overhaul

### Task 17: Document Tokens and Build the Product Shell

**Routing:** Terra, high. Use Impeccable during implementation and browser verification.

**Files:**
- Modify: `DESIGN.md`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `components/AppShell.tsx`
- Create: `components/NavLinks.tsx`
- Create: `components/ThemeToggle.tsx`
- Create: `components/ui/Button.tsx`
- Create: `components/ui/Badge.tsx`
- Create: `components/ui/InlineNotice.tsx`
- Create: `components/ui/EmptyState.tsx`
- Create: `components/ui/DataTable.tsx`
- Create: `components/ui/Pagination.tsx`
- Create: `tests/components/product-shell.test.tsx`
- Create: `tests/components/ui-components.test.tsx`

**Interfaces:**
- Produces: one reusable visual vocabulary and responsive navigation.

- [ ] **Step 1: Write failing semantic component tests**

```tsx
it('exposes navigation landmarks and the active destination', () => {
  render(<NavLinks pathname="/deliveries" isAdmin />)
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Deliveries' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

it('pairs every semantic badge color with visible text', () => {
  render(<Badge tone="warning">Retrying</Badge>)
  expect(screen.getByText('Retrying')).toBeVisible()
})
```

- [ ] **Step 2: Run RED**

Run component tests and confirm missing components.

- [ ] **Step 3: Fill `DESIGN.md` with approved exact values**

Document the physical scene, light and dark OKLCH tokens, type scale, 4px spacing base, radii, component states, 90/160/220ms motion, reduced-motion behavior, responsive breakpoints, copy rules, and the absolute bans from the approved spec.

- [ ] **Step 4: Implement shell and primitives**

Navigation order is Escalations, Applications, Deliveries, Teams, Access. Only admins see Teams and Access mutations. Use `usePathname` only inside `NavLinks`; keep `AppShell` a server component. Persist `light`, `dark`, or `system` in a `support-theme` same-site cookie. `app/layout.tsx` reads the cookie on the server and sets `<html data-theme>` for explicit choices; `system` leaves the attribute absent so the CSS `prefers-color-scheme` branches apply without a client-side flash.

- [ ] **Step 5: Verify in browser and tests**

Run component tests, typecheck, lint, and build. Use the internal browser at desktop, tablet, and small-screen viewports. Verify keyboard focus, dark mode, and reduced motion.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md app/globals.css app/layout.tsx components tests/components
git commit -m "feat: establish support portal design system"
```

### Task 18: Escalations Queue, Filters, Summary, and Keyset Pagination

**Routing:** Terra, high.

**Files:**
- Create: `lib/escalations/queries.ts`
- Create: `lib/escalations/search-params.ts`
- Modify: `app/page.tsx`
- Create: `components/escalations/EscalationFilters.tsx`
- Create: `components/escalations/EscalationTable.tsx`
- Create: `tests/unit/escalation-search-params.test.ts`
- Create: `tests/integration/escalation-queries.test.ts`
- Create: `tests/components/escalation-table.test.tsx`

**Interfaces:**
- Produces: `getEscalationQueue(input): EscalationQueuePage`, URL-stable filters, and opaque cursor.

- [ ] **Step 1: Write failing filter and cursor tests**

Assert invalid filters fall back safely, cursor encodes `(updatedAt, id)`, next page has no overlap, app/priority/status filters compose, and search escapes wildcard characters.

- [ ] **Step 2: Write failing table tests**

Assert delivery status is visible text, ticket title opens portal detail, source link is separately labeled, empty state explains the two-tier boundary, and no metric card grid exists.

- [ ] **Step 3: Run RED**

Run focused unit, integration, and component tests.

- [ ] **Step 4: Implement the read model**

```ts
export interface EscalationQueueInput {
  search?: string
  appId?: string
  priority?: FeedbackPriority
  status?: FeedbackStatus
  cursor?: string
  limit: 50
}

export interface EscalationQueuePage {
  summary: { open: number; urgent: number; newToday: number; retrying: number }
  rows: EscalationQueueRow[]
  nextCursor: string | null
}
```

Use server-rendered real data on first paint and URL query parameters for state.

- [ ] **Step 5: Run GREEN, browser verify, and commit**

```bash
git add lib/escalations app/page.tsx components/escalations tests/unit/escalation-search-params.test.ts tests/integration/escalation-queries.test.ts tests/components/escalation-table.test.tsx
git commit -m "feat: rebuild the escalation queue"
```

### Task 19: Applications and Four-Step Enrollment Interface

**Routing:** Terra, high. Use Impeccable and internal browser.

**Files:**
- Modify: `app/apps/page.tsx`
- Create: `app/apps/new/page.tsx`
- Create: `app/apps/[id]/page.tsx`
- Create: `components/enrollment/EnrollmentFlow.tsx`
- Create: `components/enrollment/InvitationReveal.tsx`
- Modify: `app/apps/actions.ts`
- Create: `lib/apps/queries.ts`
- Create: `tests/components/enrollment-flow.test.tsx`
- Create: `tests/unit/app-enrollment-actions.test.ts`
- Create: `tests/integration/app-enrollment-admin.test.ts`

**Interfaces:**
- Produces: application list/detail and `createEnrollmentAction(previousState, formData)` returning the invitation once.

- [ ] **Step 1: Write failing enrollment UI tests**

Assert step order Application, Owners, Alerts, Invitation; inline field recovery; stable slug cannot change after enrollment; the invitation is rendered once; leaving and revisiting shows only expired/consumed metadata; and copy is factual.

- [ ] **Step 2: Write failing action authorization and admin integration tests**

Assert `createEnrollmentAction` denies SUPPORT and unauthenticated callers at the server-action boundary even with a forged valid form, then submit as ADMIN and assert app, policy, technical group link, grant digest, audit event, and no plaintext secret in any database text or JSON column.

- [ ] **Step 3: Run RED**

Run the component and integration files.

- [ ] **Step 4: Implement the dedicated route**

Use one primary action per step. Preserve non-secret step values in component state. The server action begins with `requireAdminUser`, creates all persisted records in one transaction, and returns:

```ts
type EnrollmentActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string[]> }
  | {
      status: 'created'
      appId: string
      invitationId: string
      invitationSecret: string
      expiresAt: string
    }
```

Never persist `invitationSecret` in browser storage or a URL.

- [ ] **Step 5: Verify behavior and commit**

Use tests plus internal-browser desktop/tablet/small-screen verification. Do not serialize a DOM snapshot while the invitation is visible.

```bash
git add app/apps components/enrollment lib/apps tests/components/enrollment-flow.test.tsx tests/unit/app-enrollment-actions.test.ts tests/integration/app-enrollment-admin.test.ts
git commit -m "feat: add seamless application enrollment"
```

### Task 20: Deliveries, Teams, and Access Operations

**Routing:** Terra, high. Use Impeccable and internal browser.

**Files:**
- Create: `app/deliveries/page.tsx`
- Create: `lib/delivery/queries.ts`
- Create: `components/deliveries/DeliveryTable.tsx`
- Create: `app/teams/page.tsx`
- Create: `components/teams/GroupEditor.tsx`
- Create: `components/teams/ChannelEditor.tsx`
- Create: `app/access/page.tsx`
- Modify: `app/users/page.tsx`
- Create: `lib/audit/queries.ts`
- Create: `tests/components/delivery-operations.test.tsx`
- Create: `tests/components/team-editor.test.tsx`
- Create: `tests/integration/operations-queries.test.ts`

**Interfaces:**
- Produces: Pending, Retrying, Failed, History delivery views; team/channel management; users, credentials, and audit views.

- [ ] **Step 1: Write failing operations tests**

Assert failed delivery shows sanitized cause and next action, retry acknowledgement is `Delivery queued`, non-zero dead letters and unroutable incidents have text and icon, and channel destination is redacted. At route and server-action boundaries, SUPPORT may inspect only escalation queue/detail and delivery status/retry-safe operations; SUPPORT and unauthenticated callers are denied Access, users, credential security, audit, Teams, channel/policy mutation, and secret replacement. ADMIN receives those pages and mutations.

- [ ] **Step 2: Run RED**

Run focused tests.

- [ ] **Step 3: Implement server read models and screens**

Use keyset pagination for delivery history and audit. Pending and retrying views order by next attempt. Failed view orders newest first and includes `routing_incidents`. Teams exposes group membership and channel health without decrypting secrets until an explicit ADMIN-only server-side replacement action. Put `requireAdminUser` in protected page loaders and every mutation rather than relying on hidden controls.

- [ ] **Step 4: Verify all states**

Seed fictional data for sent, retrying, failed, unhealthy, disabled, empty, and unavailable states. Verify keyboard use, dark mode, and responsive column priorities in the internal browser.

- [ ] **Step 5: Run GREEN and commit**

```bash
git add app/deliveries app/teams app/access app/users/page.tsx components/deliveries components/teams lib/delivery/queries.ts lib/audit/queries.ts tests/components tests/integration/operations-queries.test.ts
git commit -m "feat: expose delivery and ownership operations"
```

### Task 21: Escalation Detail, Delivery Timeline, and Insights Preservation

**Routing:** Terra, medium.

**Files:**
- Modify: `app/feedback/[id]/page.tsx`
- Create: `lib/escalations/detail.ts`
- Create: `components/escalations/DeliveryTimeline.tsx`
- Modify: `app/activity-kpis/page.tsx`
- Create: `app/insights/page.tsx`
- Create: `tests/components/escalation-detail.test.tsx`
- Modify: `tests/unit/feedback-activity.test.ts`

**Interfaces:**
- Produces: portal detail with source action, business approval, credential/source health, and delivery timeline.

- [ ] **Step 1: Write failing detail tests**

Assert business approval is visible, reporter context stays inside authenticated detail, source app link is labeled, delivery attempts form a chronological text timeline, and stale sync is not color-only.

- [ ] **Step 2: Run RED**

Run focused component and activity tests.

- [ ] **Step 3: Implement detail and preserve useful insights**

Move the useful current Activity KPI summary to `/insights` without retaining hero metric cards. Add a secondary `View insights` link in the Escalations header, but do not add Insights to primary navigation. Change `/activity-kpis` to a permanent redirect to `/insights` for existing bookmarks. Do not change source-owned status from the portal.

- [ ] **Step 4: Run GREEN and Milestone 4 gate**

Run unit, component, integration, typecheck, lint, build, and internal-browser checks.

- [ ] **Step 5: Commit**

```bash
git add 'app/feedback/[id]/page.tsx' lib/escalations/detail.ts components/escalations/DeliveryTimeline.tsx app/activity-kpis/page.tsx app/insights/page.tsx tests/components/escalation-detail.test.tsx tests/unit/feedback-activity.test.ts
git commit -m "feat: complete escalation operations interface"
```

---

## Milestone 5: Full-Journey Verification and Release Readiness

### Task 22: Restore Real Playwright Authentication and Add Approved Journeys

**Routing:** Terra, high.

**Files:**
- Create: `e2e/setup/auth.setup.ts`
- Create: `e2e/helpers/fixtures.ts`
- Create: `e2e/scenarios/control-tower/SCN-005.spec.ts`
- Create: `e2e/scenarios/control-tower/SCN-006.spec.ts`
- Create: `e2e/scenarios/control-tower/SCN-007.spec.ts`
- Create: `e2e/scenarios/control-tower/SCN-008.spec.ts`
- Create: `e2e/scenarios/control-tower/SCN-009.spec.ts`
- Create: `e2e/scenarios/control-tower/SCN-010.spec.ts`
- Create: `scenarios/control-tower/SCN-005-enroll-application.md`
- Create: `scenarios/control-tower/SCN-006-versioned-escalation.md`
- Create: `scenarios/control-tower/SCN-007-delivery-recovery.md`
- Create: `scenarios/control-tower/SCN-008-credential-rotation.md`
- Create: `scenarios/control-tower/SCN-009-responsive-accessibility.md`
- Create: `scenarios/control-tower/SCN-010-legacy-compatibility.md`

**Interfaces:**
- Produces: authenticated browser storage state and six non-skipped end-to-end journeys.

- [ ] **Step 1: Write setup that fails if authentication is not real**

Seed a fictional admin in the test database, sign in through `/login`, assert navigation to Escalations, and save Playwright storage state. Do not inject session cookies manually.

- [ ] **Step 2: Write the six journeys**

- SCN-005: admin enrolls app and sees invitation once.
- SCN-006: generated connector key exchanges invitation, obtains token, submits escalation, and queue shows it.
- SCN-007: provider fails, delivery retries visibly, provider recovers, delivery becomes sent.
- SCN-008: next key activates, both keys overlap, old key revokes, old assertion fails.
- SCN-009: keyboard, dark mode, reduced motion, desktop, tablet, and small-screen checks.
- SCN-010: legacy POST and full pull both create durable delivery work.

- [ ] **Step 3: Run RED before completing missing glue**

Run one spec at a time and confirm each fails on the exact missing integration, not fixture setup.

- [ ] **Step 4: Add only the glue required by failing journeys**

Keep provider doubles at local HTTP endpoints. Use complete real response shapes. Reacquire locators after navigation and server-action rerenders.

- [ ] **Step 5: Recompute scenario hashes and run GREEN**

Run `npm run scenario:check` and the Chromium plus mobile projects with a test database.

- [ ] **Step 6: Commit**

```bash
git add e2e/setup e2e/helpers e2e/scenarios/control-tower scenarios/control-tower
git commit -m "test: cover support portal journeys"
```

### Task 23: Build the 500-Escalation Burst Harness

**Routing:** Terra, high.

**Files:**
- Create: `scripts/load-escalations.ts`
- Create: `tests/unit/load-escalations.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: deterministic load summary and non-zero exit on missing receipts, duplicates, missing outbox targets, p95 intake above two seconds, or p95 first attempt above 60 seconds.

- [ ] **Step 1: Write failing summary tests**

Test percentile calculation with literal samples, duplicate accounting, expected unique receipt count, and threshold failures. Do not assert only that fetch was called.

- [ ] **Step 2: Run RED**

Run the unit test file.

- [ ] **Step 3: Implement a bounded harness**

```ts
export interface LoadSummary {
  submitted: 550
  acceptedUnique: number
  duplicateReplays: number
  failed: number
  missingReceipts: number
  missingDeliveryTargets: number
  intakeP95Ms: number
  firstAttemptP95Ms: number
}
```

Generate 500 unique events plus 50 controlled duplicate retries, limit concurrency to 20, and use a dedicated enrolled fixture app. Require an explicit `LOAD_TEST_BASE_URL` and refuse production-looking hosts unless `ALLOW_SUPPORT_LOAD_TEST=1` is also set.

- [ ] **Step 4: Run GREEN locally against the test deployment**

Run: `npm run load:test:support`

Expected: 500 unique receipts, 50 duplicate responses, zero missing targets, and both latency targets met.

- [ ] **Step 5: Commit**

```bash
git add scripts/load-escalations.ts tests/unit/load-escalations.test.ts package.json package-lock.json
git commit -m "test: add peak-day escalation verification"
```

### Task 24: Reconcile Documentation, Environment, and Release Gate

**Routing:** Terra, medium for docs and scripts. Sol performs final spec compliance review.

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `SECURITY.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `.env.example`
- Modify: `CHANGELOG.md`
- Modify: `TODOS.md`
- Modify: `package.json`
- Create: `scripts/verify-support-overhaul.ts`
- Create: `tests/unit/verify-support-overhaul.test.ts`

**Interfaces:**
- Produces: one fail-fast release command and accurate product/security/operator documentation.

- [ ] **Step 1: Write failing verification-script tests**

Run the script against controlled fake command results. Assert it stops after a failed unit, integration, scenario, typecheck, lint, build, E2E, migration, or burst gate and reports the exact failed gate without continuing.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/verify-support-overhaul.test.ts`

- [ ] **Step 3: Implement the fail-fast release gate**

The script runs, in order:

```text
unit tests
integration tests against disposable Postgres
scenario drift
typecheck
lint
production build
Playwright journeys
legacy-schema upgrade rehearsal with representative rows and actual migration applied twice
500-escalation burst harness
git diff --check
```

Use `spawnSync` with argument arrays, inherit output, and exit immediately on non-zero status. Never pass secrets in command arguments.

- [ ] **Step 4: Reconcile all documentation**

- Replace stale current-state architecture and security text.
- Document channel data sent to each third party.
- Fill every remaining DESIGN.md template field with approved values.
- Add exact environment variables for pool size, channel keyring, signing JWK, and worker behavior.
- Mark the DB-backed enrollment and durable alerting backlog entries resolved only after their verification passes.
- Bump `package.json` from `0.3.2` to `0.4.0` and add a French `2026-08-12` changelog entry because this is a major internal behavior release.
- Verify the release environment uses a pooled Postgres `DATABASE_URL` before enabling the transaction-backed routes on Vercel.

- [ ] **Step 5: Run the full release gate fresh**

Run: `npm run verify:support-overhaul`

Expected: every named gate exits 0, the legacy-schema rehearsal preserves all representative rows and matches the Drizzle schema, the 500-item summary reports no missing work with p95 first attempts below 60 seconds, and `git diff --check` is empty.

- [ ] **Step 6: Perform Sol compliance review**

Review the final diff line by line against all 17 design-spec sections and 11 acceptance criteria. Any gap returns to the owning Terra task with a failing test before correction.

- [ ] **Step 7: Commit**

```bash
git add ARCHITECTURE.md SECURITY.md PRODUCT.md DESIGN.md .env.example CHANGELOG.md TODOS.md package.json package-lock.json scripts/verify-support-overhaul.ts tests/unit/verify-support-overhaul.test.ts
git commit -m "docs: complete support portal overhaul"
```

---

## Plan Self-Review Checklist

- [ ] Every design-spec section maps to at least one task.
- [ ] Transactional intake is proven before notification orchestration changes.
- [ ] Pull-created alerts have a failing regression test before the fix.
- [ ] Legacy compatibility remains active through the central implementation.
- [ ] New public-key routes bind app identity from verified credentials only.
- [ ] Invitation, assertion, token, rotation, replay, revocation, and rate-limit behaviors have independent tests.
- [ ] Channel secrets are encrypted and outbound payloads are minimized.
- [ ] Queue pagination removes the 100-row ceiling.
- [ ] Enrollment, delivery recovery, responsive behavior, theme parity, and accessibility have browser journeys.
- [ ] Full release verification includes migration rehearsal and the 500-item burst.
- [ ] No task modifies a source application or deploys production.

## Spec Coverage Map

| Approved design section | Implementation tasks |
|---|---|
| 1–5: product, evidence, ownership, architecture | 1–7, 9–11, 17–21 |
| 6: enrollment and dynamic credentials | 12–16 |
| 7: versioned escalation contract | 3, 15 |
| 8: data model and indexes | 2, 9, 12 |
| 9: routing and durable delivery | 4–6, 8–11 |
| 10: legacy compatibility | 7, 10 |
| 11: security, minimization, rate limits | 4, 8, 12–16 |
| 12: product interface and accessibility | 17–21 |
| 13: error handling | 5–6, 11, 13–16, 20 |
| 14: verification | every task, consolidated by 22–24 |
| 15: phased migration | milestone gates 1–5 |
| 16: acceptance criteria | 22–24 release gate |
| 17: approved decisions | global constraints and all owning tasks |
