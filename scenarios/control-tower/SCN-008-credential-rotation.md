---
id: SCN-008
title: Rotate an application credential with overlap
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-008.spec.ts
spec_hash: a70e93c6
---

# SCN-008 — Rotate an application credential with overlap

## Actors

- Support administrator
- Enrolled source connector
- Support Tower credential service

## Happy path

1. An administrator opens the application credential ledger and submits a connector-generated Ed25519 public JWK.
2. The portal displays the resulting one-time confirmation challenge without storing it in plaintext.
3. The connector signs the exact challenge domain string with the new private key and confirms through the existing proof route using its current credential.
4. The administrator sees both credentials during overlap and revokes the superseded key from the application page.
5. The old key's next assertion fails immediately while the new key remains usable.

## Security invariant

- Neither private key leaves the connector journey; the administrator handles only the new public JWK and one-time challenge.
