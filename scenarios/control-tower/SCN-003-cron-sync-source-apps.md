---
id: SCN-003
title: Periodic pull from configured source apps
area: control-tower
status: active
last_synced: 2026-05-12
linked_spec: e2e/scenarios/control-tower/SCN-003.spec.ts
spec_hash: 139fc186
---

# SCN-003 — Periodic pull from configured source apps

## Actors

- Vercel Cron scheduler
- Source application (Casal-track, future others) exposing a pull endpoint

## Preconditions

- `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` is configured with at least one app slug mapping to `{ url, token }`.
- The source application implements `GET <url>?since=<iso8601>` returning `{ tickets: FeedbackIngestPayload[] }` and authenticates with `Authorization: Bearer <token>`.
- `CRON_SECRET` is configured in production.

## Happy path

1. Vercel Cron calls `GET /api/cron/sync-source-apps` with `Authorization: Bearer <CRON_SECRET>` → the route lists configured slugs and pulls each.
2. For each configured slug, the puller computes `since` as the max `last_synced_at` of any ticket from that source app and GETs the upstream endpoint → the upstream returns ticket payloads created or updated since that cursor.
3. Each returned payload is piped through the existing `ingestFeedbackTicket` upsert → tickets that already exist are updated, new ones are created.
4. The response body summarizes per-app `pulled`, `created`, `updated`, `errors`.

## Alternative path: no pull config

1. `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` is empty or missing → the route returns `{ ok: true, apps: [] }` without making any outbound request.

## Edge case: upstream failure

1. The upstream endpoint returns 5xx or times out → the puller logs the failure, records `errors` for that app, and continues to the next configured slug. No partial database state remains for that app.

## Edge case: missing cron secret

1. A request arrives without the configured `CRON_SECRET` bearer in production → the route returns 401 and does nothing.

## Out of scope

- Storing a per-app last-pulled cursor in the database (we derive it from `MAX(last_synced_at)`).
- Bidirectional reply sync from the control tower back to source apps (see SCN-001 "Out of scope").
