# Architecture

This document describes the live Support Control Tower architecture and the
rules new work must preserve. It sits with PRODUCT.md, DESIGN.md, SECURITY.md,
CONTRIBUTING.md, and CLAUDE.md.

## 1. System Overview

Support Control Tower is an authenticated Next.js App Router application backed
by PostgreSQL and Drizzle. Each source application owns its reporter-facing
feedback flow. A non-technical business owner filters that feedback and
escalates only approved bugs or feature requests to the tower. The tower then
owns technical triage visibility, routing, delivery recovery, and audit history;
it does not mutate the source application's workflow state.

```text
Reporter -> source app -> business-owner approval -> versioned escalation API
                                                    |
                                                    v
                                  one PostgreSQL transaction
                                  ticket + receipt + event + outbox + audit
                                                    |
                           +------------------------+------------------------+
                           |                                                 |
                           v                                                 v
                 authenticated portal                              delivery worker
          escalations, apps, teams, delivery                email / Pushover / webhook
```

The planned operating envelope is 100–500 newly connected applications per
year, normally 20–50 approved escalations per day and at most 500 on a launch
day. Pagination, indexed queue queries, bounded worker concurrency, durable
leases, and idempotent receipts are the corresponding capacity controls.

## 2. Module Architecture

### 2.1 Operator portal

- **Surfaces:** `/`, `/feedback/[id]`, `/apps`, `/apps/[id]`, `/apps/new`,
  `/deliveries`, `/teams`, `/access`, `/insights`, and user-management routes.
- **Owns:** canonical approved-escalation queues, application enrollment and
  lifecycle controls, notification policy, delivery history and retry actions,
  and operational insight.
- **Boundary:** reporter identity and full source context appear only inside
  authenticated pages. Source links pass centralized public-URL hardening.

### 2.2 Enrollment and service authentication

- **Surfaces:** `/api/v1/enrollments/exchange`, `/api/v1/service-tokens`, and
  `/api/v1/credentials/rotate[/confirm]`.
- **Owns:** one-time 30-minute invitation grants, Ed25519 public-key enrollment,
  short-lived signed access tokens, replay prevention, rate limits, rotation,
  overlap, pause, and revocation.
- **Identity rule:** service routes derive the application ID from the verified
  credential. A request body cannot select or override application identity.

### 2.3 Escalation intake

- **Surfaces:** `POST /api/v1/escalations`, `lib/escalations/contract.ts`, and
  `lib/escalations/intake.ts`.
- **Owns:** the strict version-1 contract, canonical business-owner triage,
  byte limits, idempotency, ticket upsert, immutable event generations, routing,
  and acceptance audit.
- **Transaction:** receipt claim, ticket mutation, escalation event, routing
  incident or outbox rows, and audit event commit atomically. Provider calls
  never occur inside this transaction.

### 2.4 Routing and delivery

- **Surfaces:** `lib/routing/**`, `lib/delivery/**`,
  `/api/cron/deliver-alerts`, `/deliveries`, and escalation detail timelines.
- **Owns:** application technical-owner groups, priority policy, urgent central
  copy, central fallback, immutable minimized payloads, leased work claiming,
  retries, delivery attempts, and manual retry.
- **Recovery:** a post-commit Next.js `after()` wake-up tries immediate delivery;
  the once-per-minute cron runs the same bounded drain as durable recovery.

### 2.5 Legacy compatibility and source reconciliation

- `POST /api/feedback/ingest` remains a compatibility adapter. Its configured
  bearer token binds an authoritative app slug before the payload is normalized
  into the same transaction-backed intake path.
- `/api/cron/sync-source-apps` and `/api/feedback/[id]/refresh` consume
  `SUPPORT_TOWER_SOURCE_APP_PULL_JSON`. Bulk pulls are full reconciliations;
  the detail action requests one external ID. Every request revalidates an
  HTTPS, credential-free, standard-port target, rejects private/special-use DNS
  answers, pins the approved public addresses while retaining the original host
  for TLS SNI/certificate checks, and forbids redirects before adding the
  per-app bearer. Pulls have a 15-second deadline, read at most 1 MiB through a
  streaming bounded reader, and accept at most 500 tickets per response.
- Source status is mirrored from the source application. The tower's delivery
  and retry state never changes that source status.

### 2.6 Shared persistence

- **Surface:** `lib/db/schema.ts`, `lib/db/index.ts`, and `drizzle/**`.
- **Owns:** a process-reused, bounded node-postgres pool and all schema/index
  definitions.
- **Deployment prerequisite:** on Vercel, `DATABASE_URL` must be the database
  provider's pooled PostgreSQL endpoint, not a direct single-session endpoint.
  `DATABASE_POOL_MAX` must also fit the provider/project connection budget
  before transaction-backed routes are enabled.

## 3. Authentication and Authorization

### 3.1 Human sessions

Auth.js uses a credentials provider backed by `support_users`, scrypt password
hashes, JWT sessions capped at eight hours, and database-backed login
throttling. `ADMIN` can manage apps, teams, access, channels, and users;
`SUPPORT` can review the operational queue and deliveries.

### 3.2 Public-key application credentials

An admin creates an application and sees its invitation secret once. The
connector generates and retains its own Ed25519 private key, then exchanges the
invitation and public JWK. Client assertions are at most 60 seconds old, use
explicit issuer, subject, audience, key ID, scope and unique JTI claims, and are
recorded against replay before a five-minute tower access token is issued.
Credential state is checked again whenever an access token is used.

Rotation is proof-of-possession at both ends: the current key authorizes the
next public key, and the next private key signs a short-lived challenge. A
bounded overlap supports seamless rollout. Revocation is immediate and the
last active credential cannot be removed from an active app.

### 3.3 Legacy bearer compatibility

Each legacy slug resolves exactly one server-only
`SUPPORT_TOWER_INGEST_TOKEN_<SLUG>` variable. Constant-time comparison and the
configured slug, not payload identity, select the application. This path is a
migration bridge; new connectors use public-key enrollment.

## 4. Data Model

| Domain | Tables | Responsibility |
|---|---|---|
| Human access | `support_users`, `auth_login_attempts`, `password_reset_tokens` | Roles, login throttling, reset-token digests |
| Application identity | `source_apps`, `app_enrollment_grants`, `app_credentials`, `service_assertion_replays`, `service_rate_limit_buckets` | Lifecycle, one-time invitations, public keys, replay and abuse controls |
| Feedback | `feedback_tickets`, `feedback_replies`, `notifications` | Mirrored source record and legacy local data |
| Transactional intake | `ingest_receipts`, `escalation_events`, `routing_incidents`, `audit_events` | Idempotency, immutable generations, unroutable evidence, audit |
| Ownership and policy | `support_groups`, `support_group_members`, `notification_channels`, `app_notification_policies`, `support_settings` | Technical ownership, recipients, encrypted channel configuration, cutover state |
| Durable delivery | `delivery_outbox`, `delivery_attempts` | Immutable payload, target generation, lease/retry state, chronological attempts |

Important constraints include unique app slugs, source-app/external-ticket
identity, app/idempotency receipt identity, ticket/event generation,
event/target/generation delivery identity, credential thumbprints, assertion
JTIs, and one central fallback group. Queue, claim, health, and cleanup indexes
match their live query order.

## 5. API Inventory

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| `POST` | `/api/v1/enrollments/exchange` | Consume invitation and register a public key | One-time invitation plus trusted deployment client IP |
| `POST` | `/api/v1/service-tokens` | Exchange a signed client assertion for a five-minute access token | Ed25519 client assertion |
| `POST` | `/api/v1/escalations` | Accept one versioned, approved escalation | Access token with `escalations:write` plus `Idempotency-Key` |
| `POST` | `/api/v1/credentials/rotate` | Begin credential rotation | Access token with `credentials:rotate` and current-key proof |
| `POST` | `/api/v1/credentials/rotate/confirm` | Activate the next key | Scoped access token plus next-key challenge proof |
| `POST` | `/api/feedback/ingest` | Legacy escalation compatibility | Per-app bearer token |
| `GET` | `/api/feedback` | Read approved queue data | Auth.js session |
| `PATCH` | `/api/feedback/[id]` | Legacy authenticated feedback action | Auth.js session |
| `POST` | `/api/feedback/[id]/refresh` | Reconcile one ticket from its source | Auth.js session |
| `GET` | `/api/cron/deliver-alerts` | Recover delivery and bound maintenance cleanup | `CRON_SECRET` bearer |
| `GET` | `/api/cron/sync-source-apps` | Run configured full source pulls | `CRON_SECRET` bearer |
| `GET` | `/api/cron/daily-report` | Send the open-ticket digest | `CRON_SECRET` bearer |

Public service responses use stable JSON error codes, a correlation ID,
`Cache-Control: no-store`, bounded streamed-body reads, and no raw exception
text. Application pages and management mutations enforce Auth.js authorization
at their server boundary.

## 6. Delivery Semantics

- Routing first targets active channels for the app's technical-owner group
  that meet minimum priority. Urgent work also copies central support; absent app
  targets fall back centrally. No valid target creates a visible routing
  incident instead of losing the escalation.
- Database channel configuration is strictly validated and encrypted with
  versioned AES-256-GCM keys. Associated data binds ciphertext to channel ID,
  type, and key version.
- Workers claim only work they can start, using `FOR UPDATE SKIP LOCKED`, a
  unique lease owner, lease renewal, bounded concurrency, and ownership-checked
  finalization. Retryable transport, 429, and 5xx failures use bounded delay;
  permanent/configuration failures remain visible.
- Email and webhook targets may receive reporter name/email only when that
  authenticated channel explicitly opts in. Pushover never receives reporter
  context. Provider errors stored in the portal are sanitized classifications.

## 7. Runtime and Operations

The application uses the Node.js runtime. Required production foundations are
a pooled PostgreSQL URL, a bounded pool size, Auth.js secrets, a public HTTPS
origin, the service-token private JWK, the channel encryption keyring, and a
cron secret. Delivery defaults are fixed and tested: concurrency 20, lease 60
seconds, immediate batches of 100, no more than 500 started jobs, and a 45
second immediate-drain budget. Provider timeouts and retry policy live beside
the delivery adapters/repository rather than in deployment-specific shell
commands.

## 8. Internationalization, Theme, and Accessibility

The operator UI ships in English. Source content is preserved verbatim. Dates
and counts use `Intl`. Semantic CSS tokens implement light, dark, and system
themes without a first-paint flash. Server Components are the default; focused
client islands own navigation, theme, loading, and retry interactions. Tables
remain semantic and keyboard-scrollable on narrow screens, and color never
carries state alone.

## 9. Architectural Patterns

| Rule | Detail | Enforced by |
|---|---|---|
| **Server Components first** | Add client code only for browser state or interaction. | code review + component tests |
| **Validate every external boundary** | Runtime schemas, byte limits, safe URLs, strict channel config, and stable errors precede domain work. | Zod + unit/integration tests |
| **Identity comes from authentication** | Service payloads never choose their application identity. | route design + integration tests |
| **Acceptance and delivery are durable** | Ticket, receipt, event, route result, outbox, and audit commit together; providers run after commit. | schema + transaction tests |
| **Immutable generations explain change** | Material updates append events and target generations; attempts append chronologically. | unique constraints + tests |
| **Leases guard concurrent workers** | Claim, renew, expire, and finalize against an explicit owner. | PostgreSQL locking + integration tests |
| **Secrets remain server-only** | App private keys never reach the tower; provider configs are encrypted; raw secrets are neither logged nor stored in outbox rows. | crypto boundary + code review |
| **Safe compatibility is temporary** | Legacy bearer/pull paths normalize into central invariants and cannot bypass identity or durability. | adapter tests + cutover marker |

## Decisions Log

### 2026-08-12 — Public-key enrollment and transaction-backed escalation

- **Decision:** adopt administrator-approved one-time enrollment, connector-owned
  Ed25519 keys, short-lived access tokens, canonical business approval, and an
  atomic Postgres outbox.
- **Rationale:** 100–500 app enrollments per year cannot depend on portal
  redeployments, and an accepted escalation must survive provider outages.
- **Alternatives considered:** shared deployment bearer tokens and inline
  provider calls were rejected as operationally coupled and lossy.
- **Status:** active.

### 2026-05-12 — Outbound pull from source apps

- **Decision:** retain full and targeted pull reconciliation in addition to
  push/versioned escalation.
- **Rationale:** source state may change without a reliable emitter; pull repairs
  mirrored status without inventing a central source-of-truth transition.
- **Alternatives considered:** auto-closing stale tickets was rejected because
  silence is not evidence of closure.
- **Status:** active compatibility and reconciliation path.
