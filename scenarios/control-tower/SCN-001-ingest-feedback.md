---
id: SCN-001
title: Ingest open feedback from a source app
area: control-tower
status: active
last_synced: 2026-05-06
linked_spec: e2e/scenarios/control-tower/SCN-001.spec.ts
spec_hash: 0949bb3a
---

# SCN-001 — Ingest open feedback from a source app

## Actors

- Source application feedback loop
- Support dashboard admin

## Preconditions

- The support dashboard has `DATABASE_URL` configured.
- The support dashboard has a per-app `SUPPORT_TOWER_INGEST_TOKEN_<SLUG>` configured.
- The source application has a registered, stable app slug.
- When database notification policy is not configured yet, legacy Pushover environment credentials are configured for the durable legacy delivery target.

## Happy path

1. The source app POSTs a feedback payload to `/api/feedback/ingest` with its per-app bearer token and an `Idempotency-Key` → the configured slug, rather than payload display data, is used as the source-app authority.
2. The payload contains one open feedback ticket with external ID, kind, status, priority, title, description, reporter context, original dashboard URL, and optional transcript → durable escalation acceptance atomically stores the ticket, receipt, immutable event, audit record, and outbox delivery target.
3. After the accepted transaction commits, the dashboard schedules a bounded delivery wakeup; it returns `{ appId, ticketId, created }` immediately and does not call a provider inline.
4. The admin opens the dashboard → the ticket appears in the open queue under the configured source app and links to the original feedback dashboard.

## Alternative path: repeated sync

1. The same source app POSTs the same external ID again with an updated status or priority after work happened in the original app dashboard → a new derived idempotency key accepts the material update without duplicating the ticket and creates durable delivery work for the changed event.

## Edge case: invalid token

1. A request arrives without the configured bearer token → the API returns 401 and writes nothing.

## Out of scope

- Bidirectional reply sync from the control tower back to source apps.
