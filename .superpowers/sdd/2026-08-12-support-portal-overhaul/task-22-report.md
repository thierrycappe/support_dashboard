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
