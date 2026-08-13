---
id: SCN-003
title: Periodic pull from configured source apps
area: control-tower
status: active
last_synced: 2026-05-12
linked_spec: e2e/scenarios/control-tower/SCN-003.spec.ts
spec_hash: 686231f3
---

# SCN-003 — Periodic pull from configured source apps

## Actors

- Vercel Cron scheduler
- Source application (Casal-track, future others) exposing a pull endpoint

## Preconditions

- `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` is configured with at least one app slug mapping to `{ url, token }`.
- The source application implements `GET <url>` returning `{ tickets: FeedbackIngestPayload[] }` and authenticates with `Authorization: Bearer <token>`.
- `CRON_SECRET` is configured in production.

## Happy path

1. Vercel Cron calls `GET /api/cron/sync-source-apps` with `Authorization: Bearer <CRON_SECRET>` → the route lists configured slugs and pulls each.
2. For each configured slug, the puller performs a full sync (without a `since` cursor) and GETs the upstream endpoint → the upstream returns its current ticket payloads.
3. The configured pull slug is authoritative for each returned payload. A payload that identifies a different slug is rejected, while matching payloads are accepted through the durable legacy adapter.
4. A newly discovered ticket atomically creates a ticket, idempotency receipt, immutable event, audit record, and durable outbox alert; after commit, a bounded delivery wakeup is scheduled without waiting for any provider response inline.
5. The response body summarizes per-app `pulled`, `created`, `updated`, `errors`.

## Alternative path: no pull config

1. `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` is empty or missing → the route returns `{ ok: true, apps: [] }` without making any outbound request.

## Edge case: upstream failure

1. The upstream endpoint returns 5xx or times out → the puller logs the failure, records `errors` for that app, and continues to the next configured slug. No partial database state remains for that app.

## Edge case: missing cron secret

1. A request arrives without the configured `CRON_SECRET` bearer in production → the route returns 401 and does nothing.

## Out of scope

- Storing a per-app last-pulled cursor in the database; this scheduled route intentionally performs a full sync.
- Bidirectional reply sync from the control tower back to source apps (see SCN-001 "Out of scope").
- Activating the browser E2E scaffold; Task 22 will provide its authenticated source-app fixtures.
