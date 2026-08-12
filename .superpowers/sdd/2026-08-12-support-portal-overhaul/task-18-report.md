# Task 18 Report: Escalations Queue, Filters, Summary, and Keyset Pagination

## Outcome

Implemented the server-rendered Escalations workspace with a compact global
summary ledger, URL-stable GET filters, a durable delivery read model, and
opaque keyset pagination ordered by `(updated_at DESC, id DESC)`.

## Impeccable Product Register

- Loaded the committed product and design context before implementation.
- Used the approved operational vocabulary: Escalations, Applications,
  Delivery, technical follow-up, business approval, and source ticket.
- Kept the queue dense and ledger-like: no hero metric-card grid, no client
  fetch, no decorative dashboard treatment, and no source-owned status edits.
- Summary values are intentionally global and stable while filters narrow the
  queue rows. This preserves their role as operational bearings rather than
  making their meaning change with each filter.

## Implementation

- Added a composable PostgreSQL read model for application, priority, status,
  and escaped literal search filters. Search escapes `\\`, `%`, and `_` and
  uses an explicit `ESCAPE` clause.
- The query always requests exactly 51 rows and returns at most 50. It rejects
  a caller-controlled page size and uses the strict tuple boundary
  `(updated_at, id) < (cursor.updatedAt, cursor.id)`.
- Added a versioned, base64url opaque cursor with exact shape, ISO timestamp,
  alphabet, and length validation. Invalid/repeated URL parameters fall back
  safely and never reach SQL.
- Added global summary counts for open, urgent, new today (UTC), and currently
  retrying durable outbox rows. Delivery state is derived from immutable events
  and outbox rows; business approval comes from the persisted triage snapshot.
- Normalized source links through the established trusted source-link helper.
- Rebuilt `/` as a server component. It reads URL search parameters, performs
  queue and application reads in parallel, and renders the real first paint.
- Added a standard GET filter form and accessible responsive DataTable. Ticket
  title opens the portal detail; the external source link is separately
  labelled; delivery is visible text; empty states explain both business and
  technical tiers; the forward cursor preserves all active filters.

## RED Evidence

The first focused run was intentionally performed before production modules
existed:

```text
Failed to resolve import "@/lib/escalations/search-params"
Failed to resolve import "@/components/escalations/EscalationTable"
Failed to resolve import "@/lib/escalations/queries"
```

This proved the unit, component, and live integration tests exercised missing
behavior. During GREEN, the live query test also caught unsafe raw array SQL
interpolation and a multi-command prepared statement in the fixture; both were
corrected before acceptance.

## GREEN Evidence

| Gate | Result |
|---|---|
| Focused URL/component tests | 2 files, 5 tests passed |
| Focused live PostgreSQL query tests | 1 file, 3 tests passed |
| Full unit/component suite | 35 files, 229 tests passed |
| Full live integration suite | 15 files, 149 tests passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run scenario:check` | 4 scenarios in sync |
| `npm run build` | passed; existing multiple-lockfile warning only |
| `git diff --check` | passed |

Live query coverage includes composed filters, literal wildcard search, global
summary semantics, durable retry visibility, 55 tied timestamps across two
pages, a concurrent newer insert, no overlap, and exact fixed page size.

Browser verification was intentionally deferred to root as requested.

## Files

- `lib/escalations/queries.ts`
- `lib/escalations/search-params.ts`
- `app/page.tsx`
- `components/escalations/EscalationFilters.tsx`
- `components/escalations/EscalationTable.tsx`
- `tests/unit/escalation-search-params.test.ts`
- `tests/integration/escalation-queries.test.ts`
- `tests/components/escalation-table.test.tsx`

## Self-Review

- Cursor payloads accept only the exact versioned contract; malformed and
  oversized values degrade to the first page without exceptions.
- Pagination ordering and boundary use both columns in the same descending
  order, preventing tied timestamps from overlapping or disappearing.
- The fixed-size guard prevents later internal callers from silently changing
  the 50+1 performance and UX contract.
- UI state is wholly represented in the URL; no hydration fetch, client state,
  raw provider error, or mutable external identity was introduced.
- Concurrent Task17 changes in `NavLinks` and its tests were preserved and are
  explicitly excluded from this Task18 commit.

## Concerns

- Summary counts are UTC-day based because durable timestamps are UTC. If the
  product later requires an operator-local day, that needs an explicit trusted
  timezone contract rather than browser-dependent rendering.
