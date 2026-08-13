---
id: SCN-006
title: Submit a versioned public-key escalation
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-006.spec.ts
spec_hash: a438a71a
---

# SCN-006 — Submit a versioned public-key escalation

## Actors

- Enrolled source connector
- Support operator

## Happy path

1. The connector generates an Ed25519 key pair locally and exchanges its one-time invitation.
2. It signs a client assertion using the returned audience and receives a five-minute token.
3. It submits an approved versioned escalation with a stable idempotency key.
4. The authenticated queue and detail page show the ticket and durable Pending delivery.

## Security invariant

- The portal receives only the public JWK; the private key stays in the connector fixture.
