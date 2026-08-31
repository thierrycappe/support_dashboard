# Task 24 report: documentation, environment, and release gate

## Outcome

Task 24 reconciles the operator, security, product, design, environment, and
release documentation with the live support-overhaul architecture. It adds one
ordered fail-fast verifier and closes a source-pull bearer SSRF risk discovered
during the documentation audit.

The final consolidated gate passes with authenticated browser journeys,
legacy-schema upgrade rehearsal, the current hardened 500-escalation harness,
and exact disposable-infrastructure teardown.

## Verifier TDD evidence

1. Added `tests/unit/verify-support-overhaul.test.ts` first. The RED run failed
   because `scripts/verify-support-overhaul.ts` did not exist.
2. Implemented the minimal command runner with `spawnSync`, argument arrays,
   inherited output, `shell: false`, immediate non-zero return, and an exact
   failed-gate message.
3. Focused GREEN: 11 tests pass. They independently fail each of the ten ordered
   gates and prove no later command runs.

The script orders unit, disposable-PostgreSQL integration, scenario drift,
typecheck, lint, production build, Playwright journeys, legacy-schema rehearsal,
the 500-escalation burst, and `git diff --check`.

The disposable burst coordinator is self-contained: it applies the current
schema, generates an isolated app/portal key pair and local TLS certificate,
seeds only randomized fixture rows, builds the current production bundle
immediately before `next start`, and exposes it through a bounded loopback HTTPS
proxy. Its Next environment is an allowlist and cannot inherit live provider,
cron, pull, or channel secrets. Cleanup targets the exact app/group and run keys;
it never truncates shared test tables.

Release execution also exposed two orchestration races. The Playwright launcher
now derives its published container port from the already validated non-default
loopback base URL. SCN-010 waits, with an exact app-scoped and bounded query, for
post-response delivery work to leave pending/leased/retrying states before its
cascade cleanup. Ten consecutive focused journey repetitions then completed
without the prior delivery-finalization deadlock.

## Peak-day intake race found and fixed

The first authoritative burst attempts returned intermittent 503s. Sanitized
diagnostics identified PostgreSQL `23505` on
`service_rate_limit_buckets_pkey`, independent of delivery wake-ups. Concurrent
first inserts used the same deterministic primary-key ID while their UPSERT
handled only the canonical `(scope, subject, window_start)` conflict.

A deterministic live-PostgreSQL regression holds the first transaction open,
starts a second insert for the same tuple with a distinct row identity, and
proves the count serializes to two. Production now generates a fresh UUID for
each attempted bucket row while retaining the canonical tuple conflict arbiter,
so existing rows and semantics remain compatible. The focused integration file
passes 10/10, and the final 500+50 release burst has no intake failure.

## Source-pull security finding and TDD closure

The documentation comparison found that `SUPPORT_TOWER_SOURCE_APP_PULL_JSON`
accepted any syntactically valid URL and attached a bearer token through the
default redirect-following fetch. This could disclose the per-app token to an
HTTP, private-network, DNS-rebound, or redirect target.

RED added coverage for:

- HTTP, URL credentials, and custom ports;
- localhost, metadata/link-local, private IPv4, loopback/unique-local IPv6;
- a private current DNS answer and a resolver error containing internal detail;
- DNS revalidation and a fresh pinned dispatcher for every pull;
- redirect denial and no bearer forwarding;
- a valid public, complete source response; and
- unsafe configuration logging that contains app slug only, never the token.

The implementation reuses the webhook target validator. Before adding the
bearer on every pull it requires HTTPS without credentials or a custom port,
resolves every address, rejects any unsafe answer, pins the vetted addresses in
an Undici dispatcher while retaining the original hostname for TLS SNI and
certificate verification, sets `redirect: 'error'`, and closes the dispatcher
in `finally`. Target, transport, HTTP, and invalid-response failures are reduced
to fixed classes; configuration failures log only the configured app slug.

Focused GREEN: 58 tests passed across source pull, webhook target, refresh
route, sync cron, and release verifier. Focused ESLint and scoped diff check
also passed.

A page-boundary follow-up proved that one malformed global pull map previously
threw while rendering every otherwise valid approved escalation detail. A RED
regression now makes the optional refresh projection fail closed to
`pullConfigured: false` without logging or rendering configuration. Actual
refresh and cron execution continue to reject the malformed configuration.
The expanded focused set passes 62 tests across six files.

Task 22 then exposed an import boundary: importing source-pull transport helpers
eagerly loaded the server-only legacy intake graph. A RED import regression now
proves configuration/transport helpers load without that graph. The default
`!accept` compatibility branch dynamically imports legacy acceptance only when
it executes; injected test/Playwright acceptance never traverses `next/server`.
The expanded focused set passes 63 tests across seven files.

## Sol security review closure

The first Sol compliance/security review requested five additional boundary
fixes. TDD regressions established all failures before production changes:

- malformed pull JSON exposed raw parser detail and cron discovery threw;
- requests/bodies had no deadline, streaming byte cap, or ticket-count cap;
- per-ticket intake failures returned/logged raw exception text;
- targeted refresh accepted multiple tickets or a mismatched external ID; and
- the shared target policy admitted non-global `3fff::/20` and `5f00::/16`
  IPv6 space.

The pull path now sanitizes configuration parsing, makes malformed discovery an
empty cron set, aborts after 15 seconds, reads no more than 1 MiB/500 tickets,
cancels an overflowing body, destroys rather than waits on a dispatcher after
timeout/overflow, and emits fixed target/request/HTTP/response/intake classes.
Targeted refresh requires exactly one ticket matching both app slug and the
requested external ID. The shared webhook/source address policy rejects the two
additional non-global IPv6 allocations.

Review-fix focused verification: 74 tests passed across seven files, repository
typecheck passed, focused ESLint passed without warnings, and scoped diff check
passed.

A review follow-up covered the unfinished non-2xx mutation explicitly. Non-2xx
bodies are now cancelled and their one-request dispatcher is destroyed, so
graceful close cannot stall the cron. Injected timeout/byte limits must be
positive finite integers before DNS or bearer work begins. The final review-fix
focused set passes 81 tests across seven files.

## Documentation reconciliation

- `ARCHITECTURE.md` now describes business-owner approval, public-key
  enrollment, credential-bound identity, atomic intake/outbox persistence,
  routing/recovery, compatibility, current schema/API surfaces, and the pooled
  PostgreSQL deployment prerequisite.
- `SECURITY.md` now classifies actual stored data and secrets, states the
  cardinal approval/identity rule, documents exact third-party payload fields,
  channel minimization, service auth/rotation/rate limits, SSRF controls, and
  honest remaining gaps.
- `PRODUCT.md` reflects the approved two-tier ownership model and operating
  envelope of 100–500 app enrollments/year, 20–50 normal escalations/day, and a
  500-escalation launch-day maximum.
- `DESIGN.md` removes resolved page drift and records the authenticated browser
  journey as verified release evidence.
- `.env.example` documents the pooled database and connection budget, exact
  channel/signing/cron variables, fixed worker behavior, and exact disposable
  integration/browser/load-harness variables.
- `CHANGELOG.md` adds the French 0.4.0 behavior/security/reliability/interface
  entry dated 2026-08-12.
- `TODOS.md` resolves the implementation readiness gate and supersedes the old
  database-backed shared-token UI proposal. Pooled production database
  selection remains an explicit operator prerequisite, not a code claim.

## Final verification status

`npm run verify:support-overhaul` exited 0 from gate 1 against a fresh marked
local `*_test?support_test=1` database after current-schema provisioning and all
six support migrations. The ten ordered results were:

1. unit: 51 files, 374 tests passed;
2. integration: 17 files, 166 live-PostgreSQL tests passed;
3. scenario drift: all 10 scenarios synchronized;
4. typecheck: passed;
5. lint: passed;
6. production build: passed;
7. authenticated Playwright: 9 journeys passed on desktop and mobile, with no
   hydration, deadlock, or `after()` runtime errors in the server log;
8. legacy-schema rehearsal: 8 assertions passed, including repeat application;
9. burst: 500 unique accepted, 50 duplicate replays, zero failures, zero
   missing receipts/targets, intake p95 305 ms, first-attempt p95 352 ms; and
10. `git diff --check`: passed.

The first attempted verifier run failed at integration because the newly
created database had not yet been schema-provisioned; it is recorded only as an
environment setup failure. A later browser run exposed and then drove fixes for
non-default port orchestration, timezone hydration, and exact fixture cleanup
racing the post-commit delivery drain. The authoritative run above contains all
of those fixes. It exited normally, left no load/Next process, temporary fixture
directory, or labeled Docker resource, and the exact Task 24 databases were
dropped after verification.
