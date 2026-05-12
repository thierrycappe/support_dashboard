---
id: SCN-002
title: Stale-sync indicator on open tickets
area: control-tower
status: active
last_synced: 2026-05-12
linked_spec: e2e/scenarios/control-tower/SCN-002.spec.ts
spec_hash: 6f6f3900
---

# SCN-002 — Stale-sync indicator on open tickets

## Actors

- Support dashboard admin

## Preconditions

- The dashboard has tickets with mixed statuses and a range of `last_synced_at` values.

## Happy path

1. The admin opens the dashboard → tickets in an open status whose `last_synced_at` is older than 48 hours render a "Stale sync" badge in the status cell.
2. The admin opens a stale ticket's detail page → the same "Stale sync" badge renders next to the kind/status line in the topbar.

## Alternative path: fresh ticket

1. A ticket in an open status whose `last_synced_at` is within the last 48 hours → no stale badge.

## Edge case: terminal status

1. A ticket in a closed/fixed/shipped/declined status with a `last_synced_at` older than 48 hours → no stale badge, because the source app intentionally stopped updating it.

## Out of scope

- Auto-closing stale tickets.
- Notifying anyone when a ticket goes stale.
