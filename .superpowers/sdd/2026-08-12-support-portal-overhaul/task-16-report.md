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
