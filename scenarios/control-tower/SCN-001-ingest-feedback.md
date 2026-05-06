---
id: SCN-001
title: Ingest open feedback from a source app
area: control-tower
status: active
last_synced: 2026-05-06
linked_spec: e2e/scenarios/control-tower/SCN-001.spec.ts
spec_hash: 7ee3ad77
---

# SCN-001 — Ingest open feedback from a source app

## Actors

- Source application feedback loop
- Support dashboard admin

## Preconditions

- The support dashboard has `DATABASE_URL` configured.
- The support dashboard has `SUPPORT_TOWER_INGEST_TOKEN` configured.
- The source application knows its stable app slug.

## Happy path

1. The source app POSTs a feedback payload to `/api/feedback/ingest` with the bearer ingest token → the dashboard creates or updates the source app record.
2. The payload contains one open feedback ticket with external ID, kind, status, priority, title, description, reporter context, original dashboard URL, and optional transcript → the dashboard upserts the ticket by source app and external ID.
3. The admin opens the dashboard → the ticket appears in the open queue under the correct source app and links to the original feedback dashboard.

## Alternative path: repeated sync

1. The same source app POSTs the same external ID again with an updated status or priority after work happened in the original app dashboard → the existing tower row is updated rather than duplicated.

## Edge case: invalid token

1. A request arrives without the configured bearer token → the API returns 401 and writes nothing.

## Out of scope

- Bidirectional reply sync from the control tower back to source apps.
