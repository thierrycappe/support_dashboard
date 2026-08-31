# Task 21 report: escalation detail, delivery timeline, and insights

## Outcome

Commit `f8e4a8f` replaces the legacy feedback detail with an authenticated
operational escalation detail. It presents canonical business approval, source
connection health, reporter context inside the portal only, hardened labeled
source navigation, and chronological delivery attempts. Existing source refresh
remains available when configured and does not mutate source-owned status.

The former activity page permanently redirects to `/insights`. Insights keeps
the useful eight-week resolution summary as a compact ledger, not hero metrics;
the queue has a secondary `View insights` link and primary navigation remains
unchanged.

## TDD evidence

1. Added `tests/components/escalation-detail.test.tsx` before the new
   presentational module. The initial focused run failed because the module did
   not exist (after isolating the test from Next-auth's test-runtime import).
2. Implemented the smallest typed query, content component, and timeline to
   satisfy approval/reporter/source/stale/timeline behavior.
3. Added a live PostgreSQL integration assertion for canonical approval,
   hardened source URL normalization, stale health, and chronological attempts.

## Verification

- `npx vitest run tests/components/escalation-detail.test.tsx tests/components/escalation-table.test.tsx tests/unit/feedback-activity.test.ts` — 8 passed.
- `TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55442/support_task6_test?support_test=1' npx vitest run --config vitest.integration.config.ts tests/integration/escalation-queries.test.ts` — 6 passed.
- Scoped ESLint for all Task 21 TypeScript/TSX files — passed.
- `git diff --check` and commit `git show --check` — passed.
- Repository typecheck was attempted. It is blocked by concurrent Task 20
  in-flight test/component interface mismatches (`DeliveryOperationsRow`
  `nextAction`, team-editor props), none introduced by Task 21.
- In-app browser was not exposed to this agent. Root agent owns browser
  verification for this task.

## Self-review

- Approval comes only from `canonicalApprovedTriageSql`; malformed or missing
  triage renders an explicit absence instead of inferred approval.
- Reporter context is queried and rendered only after the route's authenticated
  session guard. No delivery payload or public page receives it.
- The source link uses `normalizeSourceTicketUrl`, retains `noopener noreferrer`,
  and is visibly labeled.
- Timeline ordering is deterministic by started time and ID. Error text is the
  stored sanitized value only.
- Detail offers no source-status mutation. Refresh is retained as an existing
  source pull action.

## Fix 1: adversarial review closure

Commit pending records the five review fixes:

- Direct detail retrieval now requires `canonicalApprovedTriageSql`, so an
  unauthenticated request redirects before querying and a direct URL to an
  unapproved ticket resolves to the normal not-found boundary.
- The detail now separately projects the newest escalation event's current
  per-target delivery state, latest routing incident, and a generation-aware
  chronological attempt history. The current delivery mapper defensively
  deduplicates repeated targets and selects the latest incident even if a
  future query/schema permits repeated incident rows.
- Refresh responses show only a fixed recovery message. Server logs retain
  ticket and app identifiers plus error class, not upstream text or payload.
- The client sets an immediate in-flight ref and pending state across the full
  fetch, suppresses repeated clicks, and reports factual refreshed/no-change
  outcomes.
- Enrollment state maps `PENDING`, `ACTIVE`, `PAUSED`, and `REVOKED`
  factually, with public-key credential health shown for active enrollment.

Fix verification:

- Focused component/page/route/unit tests: 13 passed.
- Live PostgreSQL escalation detail integration tests: 8 passed.
- Repository typecheck, lint, production build, and diff check: passed.
- Full unit suite: 276 passed, 1 concurrent Task 20 failure in
  `operations-page-guards` where its stale assertion expects one
  `listSupportUsers` call but Task 20 now intentionally makes two.
- Full integration suite completed successfully against the disposable
  `support_task6_test` database.
