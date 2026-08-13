---
id: SCN-005
title: Enroll an application with a one-time invitation
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-005.spec.ts
spec_hash: 5f419cf3
---

# SCN-005 — Enroll an application with a one-time invitation

## Actors

- Support Tower administrator

## Preconditions

- A fictional active administrator exists in the disposable test database.

## Happy path

1. The administrator signs in through the real login form.
2. The administrator enters application identity, selects an owner, and chooses the alert policy.
3. The committed invitation ID and secret appear exactly once.
4. After factual storage acknowledgement, Hide removes the secret irreversibly.
5. Application detail shows only invitation prefix and lifecycle state, never the secret.

## Edge case

- Reloading or returning to application detail cannot recover the invitation secret.
