---
id: SCN-010
title: Preserve durable legacy intake compatibility
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-010.spec.ts
spec_hash: c1eb6b44
---

# SCN-010 — Preserve durable legacy intake compatibility

## Actors

- Legacy direct connector
- Scheduled full-pull adapter
- Local fictional source provider

## Happy path

1. The registered legacy connector POSTs an authenticated approved ticket.
2. The scheduled adapter performs a full pull from a local provider returning the complete `{ tickets: [...] }` shape.
3. Both compatibility paths create immutable escalation events and durable outbox work.

## Invariant

- Provider dispatch is not performed inline with either acceptance path.
