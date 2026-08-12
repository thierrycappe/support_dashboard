# Task 16 Report — Overlapping Credential Rotation and Revocation

Date: 2026-08-12
Branch: `codex/support-portal-overhaul`
Starting HEAD: `b429035`

## Implementation

- Added `beginCredentialRotation`, `confirmCredentialRotation`, and `revokeCredential` to `lib/service-auth/credentials.ts`.
- Beginning rotation now requires a `credentials:rotate` principal and an EdDSA proof from the exact current active credential. The proof has an exact claim set, exact audience `/api/v1/credentials/rotate`, exact app/current credential/next-JWK-thumbprint bindings, a lifetime no greater than 60 seconds, and an atomically consumed nonce digest.
- Rotation creation locks app then current credential, rejects duplicate thumbprints and concurrent live pending rotations, creates one `PENDING` credential, returns a cryptographically random challenge, and persists only its SHA-256 digest with an expiry exactly five minutes after creation.
- Confirmation locks app, current credential, and pending credential in a consistent order; verifies the exact domain-separated message `support-tower-rotation:<credentialId>:<challenge>` with the pending Ed25519 key; activates the new key and caps the old key overlap at seven days in the same transaction.
- Revocation serializes on the owning app and its ordered credential rows, takes effect immediately, and refuses removal of the last currently usable key unless the app itself is paused.
- Existing `getActiveCredential` validity predicates provide automatic old-key expiry at the exact `validUntil` boundary.
- Added public JSON/no-store POST routes for begin and confirm with streamed byte limits, JSON media enforcement, scoped bearer authorization, stable correlation-bearing errors, and sanitized 503 persistence/configuration failure handling.
- No schema migration was necessary. Existing `app_credentials` pending/parent/validity fields plus `service_assertion_replays` provide the required transactionally unique digest storage without persisting challenge or nonce plaintext.

## RED evidence

Command:

```bash
npx vitest run tests/unit/credential-rotation-routes.test.ts --reporter=verbose
```

Result: failed before implementation because `@/app/api/v1/credentials/rotate/route` and its confirmation route did not exist. This retained failing suite defined the exact public envelopes and error behavior before the routes were added.

The first live GREEN attempt also caught a real implementation defect:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55442/support_task6_test?support_test=1' \
  npx vitest run --config vitest.integration.config.ts tests/integration/credential-rotation.test.ts --reporter=verbose
```

Result: 9 passed, 3 failed with `INVALID_CHALLENGE`; the decoded Node `Buffer` exposed its pooled backing allocation to WebCrypto instead of the exact signature slice. Copying into an exact `Uint8Array<ArrayBuffer>` made the intended signature bytes explicit.

## GREEN evidence

Focused routes:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

Focused live PostgreSQL lifecycle suite after test hardening:

```text
Test Files  1 passed (1)
Tests       13 passed (13)
```

This suite covers five-minute digest-only challenge storage, both possession proofs through public routes, exact app/current/thumbprint/audience/age binding, nonce replay, duplicate thumbprint, concurrent begin serialization, wrong/expired/reused challenge proofs, begin and confirm rollback, seven-day overlap, automatic boundary expiry, immediate revocation, last-key protection, paused-app exception, and concurrent revocations.

## Full verification

| Command | Result |
| --- | --- |
| `npm run test:run` | Passed: 30 files, 202 tests |
| `TEST_DATABASE_URL=... npm run test:integration` | Passed: 14 files, 134 tests (rerun after final route error-boundary hardening also 134/134) |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run scenario:check` | Passed: 4 scenarios in sync |
| `npm run build` | Passed; both credential rotation routes appear in the production route manifest |
| `git diff --check` | Passed |

The build emitted the repository's existing multiple-lockfile workspace-root warning; compilation, type checking, static generation, and route generation succeeded.

## Files

- `lib/service-auth/credentials.ts`
- `app/api/v1/credentials/rotate/route.ts`
- `app/api/v1/credentials/rotate/confirm/route.ts`
- `tests/unit/credential-rotation-routes.test.ts`
- `tests/integration/credential-rotation.test.ts`

## Self-review

- Confirmed no private JWK, raw signature, proof, challenge, nonce, or provider/database error is written to audit metadata or public errors.
- Confirmed nonce and challenge markers are transactionally coupled to their credential mutations and all injected post-write failures roll back.
- Confirmed lock order is app first, then credential rows, across begin, confirm, and revoke; concurrency tests exercise both rotation and revocation contention.
- Confirmed public handlers keep the Next.js production signature and dependency injection is confined to exported internal handler functions.
- Tightened the route error boundaries during self-review so post-auth internal failures are always sanitized 503 responses and cannot be mislabeled as access-token failures.

## Concerns

- No blocking concerns. Expired pending credential rows are retained for auditability; their challenge marker becomes unusable at the exact expiry and bounded replay maintenance can remove the expired marker. A previously used public-key thumbprint remains globally non-reusable by the schema's existing uniqueness contract.
- Mandatory Sol security review remains the parent review gate after this implementation commit.

## Fix Round 1 — Sol P2 Findings

### Implementation

- Corrected last-usable-key revocation to permit the exact authoritative terminal/paused states present in the schema: app `PAUSED`, enrollment `PAUSED`, or enrollment `REVOKED`. Active apps with `ACTIVE` or `PENDING` enrollment remain protected.
- Beginning a rotation now marks every challenge-expired `PENDING` credential for that app as `EXPIRED` under the existing app/current-credential locks. It retains the newest 20 expired rotation records per app for auditability and deletes older expired rotation credentials; replay children cascade. The same transaction still enforces at most one unexpired pending rotation.
- Added precise PostgreSQL `23505` translation for `app_credentials_thumbprint_idx` only. A real synchronized cross-app race now deterministically returns one success and one `DUPLICATE_CREDENTIAL`, with the losing transaction rolling back its nonce marker and audit. Other unique violations propagate unchanged.

### RED evidence

Command:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55442/support_task6_test?support_test=1' \
  npx vitest run --config vitest.integration.config.ts tests/integration/credential-rotation.test.ts --reporter=verbose
```

Observed expected failures before implementation:

- repeated expired rotations left 25 `PENDING` credentials instead of one;
- enrollment `PAUSED` and `REVOKED` last-key revocations returned `LAST_ACTIVE_CREDENTIAL`;
- the synchronized cross-app thumbprint race exposed raw `23505 app_credentials_thumbprint_idx` and timed out before deterministic settlement.

### GREEN evidence

Focused live suite:

```text
Test Files  1 passed (1)
Tests       20 passed (20)
```

The retained tests prove 25 sequential expiries leave exactly one live `PENDING` plus 20 retained `EXPIRED` rows; every allowed/denied app/enrollment state; one winner/one typed loser across apps; exactly one pending row, proof marker, and audit; and no translation of an unrelated injected `23505`.

Full gates:

| Command | Result |
| --- | --- |
| `npm run test:run` | Passed: 30 files, 202 tests |
| `TEST_DATABASE_URL=... npm run test:integration` | Passed: 14 files, 141 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run scenario:check` | Passed: 4 scenarios |
| `npm run build` | Passed |
| `git diff --check` | Passed |

### Self-review

- The retention mutation and new credential creation share one transaction and the same per-app lock; no scheduled global sweep or new migration is required.
- Retention deletes only `EXPIRED` rows with a non-null rotation parent and never active, pending, enrollment-created, or revoked credentials.
- Constraint mapping walks wrapped database errors but compares both exact SQLSTATE and exact named constraint.
- No challenge, nonce, private material, or database error detail is newly persisted or exposed.

### Concerns

- Cleanup is intentionally opportunistic per app at begin time: it bounds every app that continues rotating without adding global scheduled-maintenance scope. Dormant apps may retain their already finite historical rows until their next rotation.

## Fix Round 2 — Durable Expiry and Lifecycle Audit

### Implementation

- Reused `app_credentials.valid_until` as the durable pending-rotation challenge deadline. It already represents credential usability bounds: begin now writes the exact five-minute deadline, confirmation requires it to be strictly in the future, and activation clears it before installing the independent old-key overlap deadline.
- Pending expiry, retention pruning, and the one-live-pending check now use locked credential state only and never depend on replay-marker retention. Confirmation independently requires both the durable deadline and the one-time challenge digest marker, then deletes that marker transactionally.
- Every `PENDING` → `EXPIRED` transition appends `SERVICE_CREDENTIAL_ROTATION_EXPIRED` with the affected credential subject ID. Every deletion beyond the newest-20 retention bound first appends `SERVICE_CREDENTIAL_ROTATION_PRUNED` with the deleted credential subject ID. Both use fixed sanitized reasons and the current correlation ID in the same transaction.
- No migration was needed: the existing nullable UTC `valid_until` column safely expresses both pending challenge validity and active-key validity according to credential status.

### RED evidence

Command:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55442/support_task6_test?support_test=1' \
  npx vitest run --config vitest.integration.config.ts tests/integration/credential-rotation.test.ts --reporter=verbose
```

Before the fix, the new tests observed:

- pending `valid_until` was null rather than the returned five-minute deadline;
- cleanup of expired replay markers between every rotation left 25 `PENDING` credentials rather than one live plus bounded expired history;
- the lifecycle-audit rollback hook was never reached because no durable expiration occurred;
- deleting a still-live challenge marker allowed a second live pending rotation, proving the one-pending check still depended on replay state.

### GREEN evidence

Focused live PostgreSQL suite:

```text
Test Files  1 passed (1)
Tests       22 passed (22)
```

The retained tests delete expired replay markers between every attempt, still obtain one live pending and exactly 20 expired rows, and assert exactly 24 expiration audits plus four prune audits over exactly 24 credential identities. They also prove missing live replay state cannot create a second live pending rotation, activated credentials clear the challenge deadline, and injected post-expiration-audit failure rolls back both state transition and audit.

Additional completed gates:

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/credential-rotation-routes.test.ts --reporter=verbose` | Passed: 3 tests |
| `npx eslint lib/service-auth/credentials.ts tests/integration/credential-rotation.test.ts` | Passed |
| `git diff --check` | Passed |

### Full-gate coordination

The shared worktree currently contains concurrent uncommitted Task 17 RED test files (`tests/components/product-shell.test.tsx` and `tests/components/ui-components.test.tsx`) importing not-yet-created Task 17 components. Consequently repository-wide typecheck and unit collection fail only on those missing Task 17 modules. Per parent direction, this Fix Round 2 commit is scoped now; root will rerun the combined full unit, integration, typecheck, lint, scenario, and build gates after Task 17 lands.

### Self-review

- Durable deadline comparison is strict at the boundary (`valid_until <= now` expires; confirmation requires `valid_until > now`).
- Replay cleanup can remove expired digests without changing expiration, retention, or live-pending cardinality; a missing live digest prevents confirmation but does not permit parallel rotation.
- Audit records are appended before pruning and survive credential deletion because audit subjects are immutable textual identities, not credential foreign keys.
- Expiry/audit/prune/new-pending mutations share the app-locked transaction, and injected failure proves state and audit rollback together.
- No challenge, digest, JWK, nonce, signature, or database detail is included in lifecycle audits.

### Concerns

- No Task 16 blocker remains. Full repository gates await the concurrently owned Task 17 component implementation described above.
