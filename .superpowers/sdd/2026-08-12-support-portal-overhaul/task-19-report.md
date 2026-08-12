# Task 19 Report: Applications and Four-Step Enrollment

## Outcome

Implemented server-rendered application list/detail pages and an ADMIN-only
four-step enrollment path: Application, Owners, Alerts, Invitation. Enrollment
creates the application, dedicated technical group, owner memberships,
notification policy, digest-only grant, and sanitized audit atomically.

## Impeccable Product Register

- Loaded the complete committed PRODUCT and DESIGN context plus the product
  register before implementation.
- Applied the quiet operational-ledger direction and approved user vocabulary:
  application, technical group, notification policy, application key, and
  invitation.
- Used familiar server-rendered list/detail/form patterns, one primary action
  per step, visible field recovery, factual confirmations, teaching empty
  state, and no modal, hero metric, nested-card, gradient, or decorative motion.

## Implementation

- Rebuilt `/apps` as a real-data application ledger with enrollment status,
  technical group, open escalation count, and authentication recency. Only
  ADMIN users receive the `Enroll application` mutation path.
- Added `/apps/new`, ADMIN-gated before its data read, and an accessible
  four-step client form. Non-secret values remain in memory across Back/Continue
  navigation and are submitted through a server action.
- Added `/apps/[id]` for authenticated application identity, locked slug,
  owners, notification policy, and invitation prefix/expiry/terminal metadata.
  No invitation secret is queried or rendered on revisit.
- `createEnrollmentAction` begins with `requireAdminUser`, then validates exact
  HTTPS/slug/owner/policy fields before entering the repository transaction.
- `createApplicationEnrollment` performs all writes in one database
  transaction: active/PENDING/LEGACY_BEARER application, active dedicated
  technical group, validated active owner memberships, notification policy,
  32-byte invitation through the existing SHA-256 grant repository, and one
  append-only audit event. An audit failure rolls every write back.
- The invitation response contains plaintext only in the one server-action
  result. The reveal offers factual copy/hide actions, uses no URL or browser
  storage, becomes irrecoverable after Hide, and clears on `pagehide` so browser
  history cannot reveal it again.

## RED Evidence

Initial focused execution before production implementation failed exactly at
the missing boundaries:

```text
createEnrollmentAction is not a function (4 action failures)
Failed to resolve import "@/components/enrollment/InvitationReveal"
Cannot find package '@/lib/apps/queries'
```

A later deliberate page-leave test failed because the invitation secret stayed
visible after `pagehide`; the listener implementation turned that test GREEN.

## GREEN Evidence

| Gate | Result |
|---|---|
| Focused component/action suite | 2 files, 8 tests passed |
| Focused live PostgreSQL suite | 1 file, 2 tests passed |
| Full unit/component suite | 37 files, 244 tests passed |
| Full live integration suite | 16 files, 153 tests passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed after root's unrelated tracked raw-link fix; that file is excluded from this commit |
| `npm run scenario:check` | 4 scenarios in sync |
| `npm run build` | passed; existing multiple-lockfile warning only |
| `git diff --check` | passed |

The first full unit attempt briefly observed a concurrent IPv6 source-link edit
between its source and test; the exact suite then passed 10/10, the concurrent
fix committed, and the clean full rerun passed 244/244.

## Browser Verification

The required in-app browser could not be selected: the runtime returned
`Browser is not available: iab`, and the documented browser inventory returned
zero backends. Per the explicit internal-browser requirement, no alternate
browser surface was substituted. Root will perform desktop, tablet, and small
viewport verification when the in-app browser is available. No DOM snapshot
was serialized while a secret was visible.

## Files

- `app/apps/actions.ts`
- `app/apps/page.tsx`
- `app/apps/new/page.tsx`
- `app/apps/[id]/page.tsx`
- `components/enrollment/EnrollmentFlow.tsx`
- `components/enrollment/InvitationReveal.tsx`
- `lib/apps/queries.ts`
- `tests/components/enrollment-flow.test.tsx`
- `tests/unit/app-enrollment-actions.test.ts`
- `tests/integration/app-enrollment-admin.test.ts`

## Self-Review

- Authorization precedes FormData parsing, so forged SUPPORT and
  unauthenticated submissions cannot reach validation or mutation.
- Active owners are revalidated inside the same transaction; duplicate,
  missing, or disabled identities abort the complete enrollment.
- The live privacy proof enumerates every text, varchar, JSON, and JSONB column
  in the public PostgreSQL schema and finds zero plaintext-secret occurrences.
- Detail queries select only grant prefix and lifecycle timestamps. Tests prove
  available, consumed, and exact-expiry metadata without secret recovery.
- The rollback injection fails at the final audit validation after all earlier
  writes, proving application, group, membership, policy, and grant rollback.
- The generated `next-env.d.ts` development-route line was restored to its
  tracked production form and all unrelated shared changes remain unstaged.

## Concerns

- Browser viewport verification is outstanding solely because the requested
  in-app browser backend was unavailable in this agent runtime.

## Fix Round 1 — Sol review

### Implementation

- One-time invitations now require an explicit stored/copied acknowledgement
  before Hide or navigation. Refresh, sidebar links, and Back are guarded while
  unacknowledged; `pagehide` always destroys plaintext, including BFCache
  departures after acknowledgement. Clipboard denial leaves both values visible
  for manual copy and uses a separate factual message from navigation warnings.
- Cache invalidation is best effort after the enrollment transaction commits,
  so invalidation failure cannot discard the only plaintext response.
- Shared URL validation rejects malformed, non-HTTPS, and credential-bearing
  application URLs before persistence; detail output fails closed for unsafe
  legacy values.
- Application counts reuse the escalation queue's canonical approved-triage SQL.
- Progress uses one semantic ordered-list marker; owner choices are 44px flex
  rows, and action groups stack at the existing small-screen breakpoint.

### RED / GREEN evidence

Initial focused execution failed six unit/component and two live PostgreSQL
assertions covering every review finding. A final deliberate malformed-URL test
failed with `TypeError: Invalid URL`, then passed through the consolidated safe
validator.

| Gate | Result |
|---|---|
| Focused action/component suite | 2 files, 14 tests passed |
| Focused Task19 live PostgreSQL suite | 1 file, 4 tests passed |
| Existing escalation-query live suite | 1 file, 5 tests passed |
| Complete tracked unit/component inventory | 36 files, 244 tests passed |
| Scoped ESLint and `git diff --check` | passed |

The combined type/build gate is temporarily blocked only by concurrent Task20
RED imports for operations components that are not part of this commit. Root
will run the combined shared-worktree gates after Task20 lands.

### Self-review

- Navigation and clipboard messages are distinct and factually accurate.
- The unconditional `pagehide` listener prevents browser Back from reviving an
  acknowledged component state containing plaintext.
- Repository and action paths share URL safety; existing unsafe data is not
  rendered.
- No Task20, progress-ledger, or generated Next.js changes are included.
