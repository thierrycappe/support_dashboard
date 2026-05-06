# Architecture

This document is both a description of the live architecture and the architectural constitution every artefact this project produces inherits. Sections 1–8 describe the system as it ships. The "Architectural Patterns" section at the end enumerates the rules; each rule ends with `Enforced by:`.

Sits with PRODUCT.md (strategy), DESIGN.md (visual + UX writing), SECURITY.md (data policy), CONTRIBUTING.md (engineering), CLAUDE.md (AI behaviour).

## 1. System Overview

Support Control Tower is a Next.js App Router application that receives feedback-ticket snapshots from multiple source applications, stores them in Postgres via Drizzle, and presents an authenticated link index of open work. Source apps remain the operational dashboards and systems of record. The tower mirrors status through a bearer-token ingest API.

```
+----------------------+       +-----------------------+
|  Source applications |  -->  | /api/feedback/ingest |
|  feedback loops      |       +-----------+-----------+
+----------------------+                   |
                                           v
+----------------------+       +-----------------------+
|  Admin browser       |  -->  | Next.js App Router    |
+----------------------+       | Auth + dashboard      |
                               +-----------+-----------+
                                           |
                                           v
                               +-----------------------+
                               | Postgres + Drizzle    |
                               +-----------------------+
```

## 2. Module Architecture

The system has three cohesive modules.

### 2.1 Control tower dashboard

- **Surface:** `/`, `/apps`, `/feedback/[id]`, `components/AppShell.tsx`.
- **Owns:** dashboard query composition, source-app link presentation, and fallback local snapshot views.
- **Depends on:** Auth.js session, Drizzle data access.

### 2.2 Feedback ingest

- **Surface:** `POST /api/feedback/ingest`, `lib/feedback/ingest.ts`.
- **Owns:** payload validation, source app upsert, ticket upsert, original dashboard URL storage, raw payload retention.
- **Depends on:** shared bearer ingest token, Drizzle schema.

### 2.3 Feedback data model

- **Surface:** `lib/db/schema.ts`, `lib/feedback/status.ts`, `lib/feedback/dashboard.ts`.
- **Owns:** source apps, tickets, replies, notifications, lifecycle helpers.
- **Depends on:** Postgres-family database.

## 3. Authentication

The system has two authentication mechanisms.

### 3.1 Admin session

- Where configured: `auth.ts` and `app/api/auth/[...nextauth]/route.ts`.
- Session strategy: Auth.js JWT session with a database-backed credentials provider.
- Validation rules: active users in `support_users` authenticate with scrypt password hashes.
- Bootstrap: `SUPPORT_DASHBOARD_ADMIN_EMAILS` and `SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH` can create the first admin user.
- Roles: `ADMIN` can manage users; `SUPPORT` can work the support queue.
- Routes covered: dashboard pages, user management pages, and authenticated feedback APIs.

### 3.2 Source app ingest token

- Where configured: `app/api/feedback/ingest/route.ts`.
- Strategy: bearer token in `Authorization` header.
- Validation rules: token must match the per-app entry in `SUPPORT_TOWER_INGEST_TOKENS_JSON`.
- Routes covered: `POST /api/feedback/ingest`.

## 4. Database Schema

### 4.1 Enums

Enums: `AppStatus`, `FeedbackKind`, `FeedbackPriority`, `FeedbackStatus`, `NotificationKind`, `AuthUserRole`, `AuthUserStatus`.

### 4.2 Tables — `<domain>` domain

| Table | Purpose | Key relationships |
|---|---|---|
| `source_apps` | Registered upstream applications sending feedback | Parent for tickets |
| `feedback_tickets` | Normalized bug/evolution tickets from source apps | FK to `source_apps.id` |
| `feedback_replies` | Future admin replies that can sync back to source apps | FK to `feedback_tickets.id` |
| `notifications` | Future in-app operator notifications | Optional FK to `feedback_tickets.id` |
| `support_users` | Admin/support login accounts | None |
| `auth_login_attempts` | Login throttling audit rows | None |

Repeat per domain (auth, billing, content, etc.) — group related tables together.

### 4.3 FK conventions and totals

- Total tables: 6.
- FK style: child feedback rows cascade when the source app or ticket is deleted.
- Index naming: `<table>_<column>_idx`, with unique app/ticket identity at `feedback_tickets_source_external_idx`.

## 5. API Routes

### 5.1 Inventory

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/feedback/ingest` | Source apps upsert one feedback ticket | Bearer ingest token |
| `GET` | `/api/feedback` | Return open tickets for authenticated clients | Auth.js session |
| `PATCH` | `/api/feedback/[id]` | Reserved for future local annotations; source apps currently own status updates through ingest | Auth.js session |

### 5.2 Runtime configuration

All routes use the default Node.js runtime and JSON responses. No streaming route exists yet.

## 6. AI Integration Patterns

No AI provider is called by the control tower yet. Source applications may already use AI chat intake from `deploy-feedback-system`; their `markdownSpec` and normalized transcript are accepted and preserved.

## 7. Internationalization

The admin UI is single-locale English for now. Ticket content from source apps is stored verbatim and can be French, English, or another language.

## 8. Theme System

Theme tokens are plain CSS custom properties in `app/globals.css`. Components use semantic classes (`panel`, `badge`, `button`) rather than inline color decisions.

## 9. Architectural Patterns

The rules below govern this project and every artefact it generates. Each ends with `Enforced by:`.

### 9.1 Framework defaults

| Rule | Detail | Enforced by |
|---|---|---|
| **Server Components first** | New views start as server components. Drop to client only when interactivity, browser-only APIs, or live state demand it. The directive is a deliberate decision, not a default. | code review |
| **One concern per module** | A file exports either pure functions, one component, one route, or one schema, not a mix. | code review |

### 9.2 Data layer

| Rule | Detail | Enforced by |
|---|---|---|
| **Type-safe at every boundary** | Validate external input (route bodies, env vars, third-party responses) with a runtime validator at the boundary. Internal call sites trust their callers. | code review + schemas colocated with each boundary |
| **Versioning is immutable** | When user-visible artefacts mutate, the prior version is preserved as an immutable snapshot row, not overwritten. Audit and undo depend on this. | schema design + code review |
| **State machines guard transitions** | Any process with more than two named states declares an explicit `assertTransition(from, to)`. Routes call the assertion before mutating; illegal transitions throw. | code review + unit tests on the transition table |

### 9.3 Authentication

| Rule | Detail | Enforced by |
|---|---|---|
| **Single named auth call per route** | Each route declares its requirement with one named helper (`requireSession()`, `requireAdmin()`, `requirePublic()`), not duplicated inline. | code review |
| **No secrets in client code** | API keys, tokens, signing keys live in env vars accessed server-side only. Client-prefixed env vars are for non-secret values only. | env review + code review |

### 9.4 External integrations

| Rule | Detail | Enforced by |
|---|---|---|
| **No internal-system connections from generated artefacts** | Restated from SECURITY.md "Cardinal Rule". Generated apps must not contain network calls to internal hostnames, connection strings, or templated credentials. Mock data only. | prompt + post-generation scan + design-review |

(Add or remove subsections to match what the project actually does — billing, observability, AI, etc. The pattern is: rule | detail | enforced by.)

## Decisions Log

Append-only log of architectural decisions. Each entry: date, decision, rationale, alternatives considered, status.

### YYYY-MM-DD — `<Decision title>`
- **Decision:** ...
- **Rationale:** ...
- **Alternatives considered:** ...
- **Status:** active | superseded by `<later entry>` | deprecated
