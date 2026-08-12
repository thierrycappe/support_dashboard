---
id: SCN-007
title: Recover a retrying delivery
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-007.spec.ts
spec_hash: 39793362
---

# SCN-007 — Recover a retrying delivery

## Actors

- Delivery worker
- Support operator
- Local fictional provider

## Happy path

1. The worker dispatches a durable delivery to a local provider double.
2. A complete temporary 503 response schedules retry and the Deliveries screen shows Retrying with a sanitized cause.
3. The provider recovers with a complete accepted response.
4. The next worker sweep records a second immutable attempt and the History screen shows Sent.

## Privacy invariant

- The visible failure contains only the sanitized HTTP classification.
