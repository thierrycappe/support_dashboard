# Task 23 Report — Peak-Day Escalation Verification

## Outcome

The harness sends exactly 500 original HIGH escalations followed by 50
controlled idempotent replays, with at most 20 concurrent requests. It refuses
non-local endpoints without an explicit override, validates the dedicated
active test application, active credential/private-key thumbprint, and exact
active database targets before any cleanup or submission, and always cleans a
validated run by its exact 500 deterministic identities rather than a prefix.

Persistence verification requires one receipt, exactly one escalation event,
the complete expected target-key set, and a first delivery attempt for every
target of every accepted original. Replay HTTP semantics are phase-aware: an
original must return `created` and a replay must return `duplicate`; a replay
cannot overtake an original that is retrying after a `429`.

The global submission deadline remains active through response-body
consumption. Token exchange and database statements are bounded, and the
five-minute service token is refreshed 30 seconds before expiry during longer
runs.

## TDD evidence

The hardening RED run had seven focused failures covering rejected-fixture
cleanup, stalled response bodies, exact event/target persistence, replay
semantics, and token refresh. The first GREEN attempt retained two useful REDs:
a concurrent replay overtook its throttled original, and aborted JSON parsing
was reduced to an ordinary malformed body. Two-phase submission and
abort-aware body reading close those cases.

## Owner-recorded prior live evidence

The Task 23 owner recorded the pre-hardening run below. This is historical
evidence reported by the owner, not a persisted command-output artifact and not
the authoritative proof for the hardened semantics.

- Environment: disposable local HTTPS Next server and disposable
  `support_load_test` database.
- Fixture: dedicated active enrolled PUBLIC_KEY app with one active database
  target; production rate limits were unchanged.
- Result: `submitted=550`, `acceptedUnique=500`, `duplicateReplays=50`,
  `failed=0`, `missingReceipts=0`, `missingDeliveryTargets=0`,
  `intakeP95Ms=452`, `firstAttemptP95Ms=602`, `throttledRetries=80`,
  `durationMs=216358`, `deadlineMs=480000`, `maxRetries=30`, and
  `failureStatuses={}`.
- All 500 current-run outboxes had first attempts. Harness cleanup completed,
  the database was dropped, and ephemeral JWK/certificate material was never
  persisted.

## Authoritative hardened release evidence

The consolidated Task 24 verifier ran the current hardened harness against a
fresh, explicitly marked local PostgreSQL database after applying the current
Drizzle schema and all six support migrations. The self-contained fixture built
the current production bundle immediately before `next start`, served it
through a bounded local HTTPS proxy, seeded only randomized rows, and removed
those exact rows and ephemeral certificate/key files afterward.

- `submitted=550`, `acceptedUnique=500`, `duplicateReplays=50`, `failed=0`
- `missingReceipts=0`, `missingDeliveryTargets=0`
- `intakeP95Ms=305`, `firstAttemptP95Ms=352`
- `throttledRetries=80`, `durationMs=237453`, `maxRetries=30`
- one exact expected database-channel target and `failureStatuses={}`

The harness exited 0. No load process, Next server, temporary fixture directory,
or fixture database remained after teardown.
