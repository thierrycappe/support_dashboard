---
id: SCN-008
title: Rotate an application credential with overlap
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-008.spec.ts
spec_hash: 81c6954c
---

# SCN-008 — Rotate an application credential with overlap

## Actors

- Enrolled source connector
- Support Tower credential service

## Happy path

1. The current key proves possession and registers a generated next public key.
2. The next private key signs the exact challenge domain string.
3. Confirmation activates the next credential and both keys obtain tokens during overlap.
4. Revoking the old credential makes its next assertion fail immediately while the next key remains usable.

## Security invariant

- Neither private key leaves the connector journey.
