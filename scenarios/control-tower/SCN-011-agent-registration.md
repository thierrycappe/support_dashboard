---
id: SCN-011
title: Register an application through trusted agent provisioning
area: control-tower
status: active
last_synced: 2026-09-11
linked_spec: e2e/scenarios/control-tower/SCN-011.spec.ts
spec_hash: 7026f033
---

# SCN-011 — Agent application registration

## Actors

- A trusted provisioning agent acting for an existing active administrator.

## Preconditions

- The disposable tower has a configured provisioning token digest, actor, and Vercel team.
- The agent generates and retains its application private key locally.

## Happy path

1. The agent submits application identity, ownership, Vercel binding, and public key with its provisioning credential.
2. The tower atomically creates an active application, ownership, notification policy, and credential; the response contains only IDs and endpoint metadata.
3. Repeating the same registration returns the same IDs without creating duplicate records or rotating credentials.
4. The registered application signs an assertion with its private key and obtains a short-lived service access token.

## Edge cases

- Missing or invalid provisioning credentials are rejected.
- A different key for the same registration conflicts and does not change the working credential.
- A registration for a different Vercel team is rejected.
