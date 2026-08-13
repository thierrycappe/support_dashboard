# Task 22 Report — Real Playwright Authentication and Approved Journeys

## Outcome

Implemented real Playwright authentication and six non-skipped, scenario-linked support portal journeys. The suite signs in through `/login`, uses generated fictional credentials only, persists test auth state under an ignored exact path, and runs serially against a safety-gated disposable PostgreSQL database.

## Implementation

- Added a Playwright setup project that seeds an ACTIVE ADMIN with a hashed fictional password, completes the real login form, verifies the Escalations landing page, and writes storage state only after authentication succeeds.
- Added a safety-gated server launcher that applies the current Drizzle schema to the approved disposable database and generates auth/service signing material in-process without command arguments or logs.
- Added shared Ed25519 connector enrollment, client assertion, access-token, escalation, database, and per-scenario isolation fixtures.
- Added SCN-005 through SCN-010 and matching scenario documents/hashes:
  - one-time administrator enrollment invitation;
  - enrollment exchange, service token, versioned escalation, and queue/detail visibility;
  - complete local HTTP provider failure/recovery responses with visible retry and immutable attempt history;
  - current-key proof, next-key confirmation, overlap, real domain revocation, and old-key rejection;
  - desktop keyboard skip link, dark scheme, reduced motion, and 1024/390/320 responsive checks in Chromium and mobile projects;
  - direct legacy POST plus full source pull through the injected fetch/target boundary, with both paths using real HTTP ingestion and producing durable outbox work.
- Added `tabIndex={-1}` to the main landmark so the skip link transfers focus, made Playwright use the auth dependency for all journey projects, and ignored only `playwright/.auth/`.
- Kept hardened production source-pull SSRF behavior intact. The source response uses the existing injected validation/fetch seam; legacy acceptance still crosses the real HTTP route.

## RED evidence

The journey-first runs failed at the intended integration boundaries before the final glue/assertions:

- Auth setup initially failed because an imprecise Escalations locator matched both the page heading and empty-state text; it was made exact after proving the real redirect.
- SCN-005 exposed rerun fixture uniqueness and was corrected with per-scenario application naming.
- SCN-006 initially failed on invalid reporter shape, then exposed ambiguous source/title and channel locators; the payload and locators now match the public contract exactly.
- SCN-007 initially raced unrelated eligible rows in a shared parallel database; the suite is serial and the provider journey scopes its fixture rows.
- SCN-008 initially sent the entire rotation response to the strict confirmation schema; confirmation now sends only the exact public fields.
- SCN-009 failed after activating the skip link because the main landmark was not programmatically focusable. The minimal `tabIndex={-1}` accessibility fix made the focus assertion pass. Mobile touch projects also proved desktop Tab traversal is not applicable there, while retaining all mobile visual/interaction checks.
- SCN-010 failed once source-pull SSRF hardening correctly rejected a localhost HTTP source. The final journey uses `pullSourceApp` with its explicit injected target/fetch seams and real legacy HTTP acceptance; there is no production bypass or unsafe cron configuration.
- The first combined Chromium run was 5/7, failing SCN-009 focus traversal and a reused support-group name in SCN-010. After exact fixture fixes, the same combined command passed 7/7.
- The first mobile run passed auth but failed mobile Chrome on the desktop-only keyboard assumption and could not launch absent WebKit. After scoping keyboard traversal appropriately and installing the matching browser runtime, both mobile projects passed.

## GREEN evidence

All database URLs below were the approved disposable local URL ending in `_test` with `support_test=1`; it is redacted here.

- `npm run scenario:check` — PASS, 10 scenarios in sync.
- `TEST_DATABASE_URL=<approved> npx playwright test --project=chromium` — PASS, 7/7 (real auth setup plus SCN-005–010).
- `TEST_DATABASE_URL=<approved> npx playwright test e2e/scenarios/control-tower/SCN-009.spec.ts --project=mobile-chrome --project=mobile-safari` — PASS, 3/3.
- `npm run test:run` — PASS, 48 files / 335 tests.
- `TEST_DATABASE_URL=<approved> npm run test:integration` — PASS, 17 files / 163 tests.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run build` — PASS, production build and route generation completed.
- `git diff --check` — PASS.

## Files

- `.gitignore`
- `components/AppShell.tsx`
- `playwright.config.ts`
- `e2e/setup/auth.setup.ts`
- `e2e/setup/start-server.ts`
- `e2e/helpers/fixtures.ts`
- `e2e/scenarios/control-tower/SCN-005.spec.ts` through `SCN-010.spec.ts`
- `scenarios/control-tower/SCN-005-enroll-application.md` through `SCN-010-legacy-compatibility.md`

## Self-review

- No session storage, certificate, key, invitation, bearer token, or generated credential is staged. `playwright/.auth/` is ignored exactly, generated auth state was removed after verification, and `next-env.d.ts` was restored.
- All providers are fictional and local/injected. No external delivery was attempted; database delivery configs are intentionally undecryptable test fixtures and do not expose destinations.
- The six scenarios are non-skipped, use the authenticated setup dependency, reacquire locators after navigation/server rerenders, and run with one worker because they share a disposable database.
- SCN-010 does not weaken source URL validation: its injected seam exercises pull orchestration while the actual durable acceptance uses the hardened legacy HTTP endpoint twice.
- Only Task 22 files are included in the scoped commit; concurrent Task 23/24 documents, package, source-pull, webhook, route, and unit-test changes remain unstaged.

## Concerns

- Playwright's Next development server emits the existing multiple-lockfile workspace-root warning and Node's existing `module.register()` deprecation warning; neither affects the verified journeys.
- The test schema launcher uses `drizzle-kit push --force` only against an explicitly approved disposable browser database. It refuses non-`_test` databases and URLs without `support_test=1`.

## Fix Round 1 — production-path journeys and fixture safety

### Implementation

- Replaced SCN-007's repository-level simulation with `runDeliverySweep` and `dispatchDelivery`, sending through the production Pushover adapter to a complete local HTTP provider. Added an optional, bounded, deduplicated `deliveryIds` scope to the production claim path so the journey can claim only its randomized row without touching unrelated work.
- Replaced SCN-010's injected pull seams with the real authorized `/api/cron/sync-source-apps` route and default pull/acceptance path. The isolated app container serves a generated-CA HTTPS source on a public documentation-range address, trusts only that ephemeral CA, and exercises the hardened pinned-DNS validation unchanged.
- Added a Docker-isolated launcher with a minimal allowlisted child environment. It never inherits real provider, signing, auth, keyring, or database credentials; generated test secrets live only in a mode-0600 env file mounted into the disposable container and never appear in Docker arguments or logs.
- Made the Playwright target guard accept only normalized loopback origins with no credentials, path, query, or fragment. Remote mutation is refused unconditionally.
- Added exact-prefix/labeled container and network cleanup plus removal of runtime env/JSON and ephemeral CA material on normal exit, signals, startup failures, and subsequent stale-run startup.
- Strengthened SCN-009 to compare shipped light/dark computed colors and prove computed transition durations collapse under reduced motion. Its keyboard check uses a real focus traversal and responsive checks remain at 1024, 390, and 320 pixels.
- Randomized and explicitly cleaned scenario-owned rows. SCN-007 delays only its own row from background wakeups and scopes both sweeps; SCN-010 deletes only its randomized source application graph through existing cascades.
- Added the local development origin required by the isolated container and made the rotation journey use an authoritative post-confirmation revocation boundary.

### RED evidence

- `npx vitest run tests/unit/playwright-environment.test.ts` initially failed because the strict target/environment module did not exist. The retained table-driven suite now covers remote targets (including the former override), private/non-loopback hosts, credentials, path/query/fragment, inherited secret removal, and Docker env-file argument construction.
- The retained delivery-worker integration mutation used `aaa-job-unrelated` ahead of `zzz-job-scoped`; before production scoping, the requested fixture stayed PENDING and the unrelated row was claimed.
- The first production-adapter browser run reported SCN-007 `{ claimed: 0, started: 0 }` because the Next wakeup raced its eligible row. Moving only that randomized row into the future and passing an explicit sweep clock removed the race without pausing background behavior.
- SCN-009 initially failed exact string comparison because Chromium serialized `0.01ms` in scientific notation. Numeric normalization plus a positive normal-motion assertion now catches removed or ineffective reduced-motion CSS.
- SCN-010's earlier injected implementation was deleted. The replacement initially could not start because the minimal container lacked OpenSSL; installing it in the test-only image made the generated-CA/default-route journey executable.
- Launcher shutdown initially left a labeled empty Docker network and runtime files because `npx` intercepted Playwright's signal. Direct `exec` signal propagation and exact retrying cleanup made post-run resource assertions empty.

### GREEN evidence

All database-backed commands used the approved disposable localhost database `support_task22_fix_test` with `support_test=1`; credentials are intentionally omitted.

- `npx vitest run tests/unit/playwright-environment.test.ts` — PASS, 1 file / 10 tests.
- `npx vitest run --config vitest.integration.config.ts tests/integration/delivery-worker.test.ts` — PASS, 1 file / 16 tests.
- `npx playwright test --project=chromium` — PASS, 7/7 in 22.8 seconds (real auth plus SCN-005–010).
- `npx playwright test --project=mobile-chrome --project=mobile-safari` — PASS, 3/3 in 13.9 seconds.
- `npm run test:run` — PASS, 50 files / 367 tests.
- `npm run test:integration` — PASS, 17 files / 165 tests in 27.31 seconds. An earlier invocation was accidentally overlapped with another full integration process and produced catalog/FK interference; the required unattended single serial command passed after both exited.
- `npm run typecheck` — PASS.
- `npm run scenario:check` — PASS, 10 scenarios in sync.
- `npm run lint` — PASS.
- `npm run build` — PASS, optimized production build and route generation completed.
- `git diff --check` — PASS.

### Files and self-review

- Safety/launcher: `.dockerignore`, `.gitignore`, `playwright.config.ts`, `next.config.ts`, and `e2e/setup/{Dockerfile,container-launcher.ts,environment.ts,launch-server.ts,start-server.ts}`.
- Journeys: `SCN-007.spec.ts`, `SCN-008.spec.ts`, `SCN-009.spec.ts`, and `SCN-010.spec.ts`.
- Scoped worker support and tests: `lib/delivery/{repository.ts,worker.ts}`, `tests/integration/delivery-worker.test.ts`, and `tests/unit/playwright-environment.test.ts`.
- No production SSRF exception or test-only application route was added. SCN-007's provider is local and injected only through the adapter's existing fetch seam; SCN-010 traverses the production cron/default pull stack.
- No auth state, env file, certificate, provider credential, keyring, plaintext secret, Playwright report, or screenshot is included. Post-browser inspection found no Task 22 container, network, runtime file, CA directory, or browser process.
- Concurrent Task 23/24 documentation, package, route, scripts, and tests remain unstaged.

### Concerns

- Next development mode logs an existing server/client timezone hydration warning on delivery timestamps because the host and isolated container use different time zones. It does not alter the production-path assertions, but timestamp formatting should use an explicit shared time zone in a later UI hardening pass.

## Fix Round 2 — deterministic delivery timestamps

### Root cause and implementation

- The release verifier reproduced React hydration failure in `DeliveryTable`: its client component created `Intl.DateTimeFormat` without `timeZone`, so the isolated server rendered UTC while a Europe/Paris browser hydrated the same instant as CEST.
- Configured the existing compact `en` medium-date/short-time formatter with `timeZone: 'UTC'` and added the visible factual `UTC` suffix. This matches the established delivery timeline treatment, keeps the operational ledger scannable, and produces identical server/client text without suppressing hydration warnings.

### RED evidence

- Added a retained component regression with the hand-derived instant `2026-08-12T13:40:00.000Z` and expected display `Aug 12, 2026, 1:40 PM UTC`.
- `npx vitest run tests/components/delivery-operations.test.tsx` — RED, 1 failed / 4 passed. The Europe/Paris process rendered `Aug 12, 2026, 3:40 PM`, proving the test catches the missing timezone rather than a fixture or selector failure.

### GREEN evidence

- `npx vitest run tests/components/delivery-operations.test.tsx` — PASS, 1 file / 5 tests.
- `TEST_DATABASE_URL=<approved> npx playwright test e2e/scenarios/control-tower/SCN-007.spec.ts --project=chromium` — PASS, auth plus SCN-007 2/2 in 12.4 seconds; the original server/browser output contained no hydration mismatch.
- `npm run test:run` — PASS, 50 files / 369 tests.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run build` — PASS, optimized production build and route generation completed.
- `git diff --check` — PASS.

### Scope and self-review

- Changed only `components/deliveries/DeliveryTable.tsx`, `tests/components/delivery-operations.test.tsx`, and this report.
- The semantic `<time dateTime="...">` retains the exact ISO instant. The visible timezone is explicit, and no `suppressHydrationWarning` or client-only rendering escape hatch was added.
- Concurrent Task 24, rate-limit, deadlock, verifier, environment, package, documentation, and progress changes remain unstaged.
