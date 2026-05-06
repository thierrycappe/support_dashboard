# CLAUDE.md

## Behavioral defaults

- Always load `.env.local` with `dotenv` for database connections; use local credentials in development, never production credentials.
<!-- scaffold:env-local-dotenv:de349246 -->
- For fuzzy requirements run /office-hours; for plan stress-test run /plan-ceo-review; for architecture lock-in run /plan-eng-review — before writing implementation code.
<!-- scaffold:gstack-decision-layer:24a9da64 -->
- When recording a TODO in `TODOS.md`, use this shape: `**Priority:** P0/P1/P2 | **Effort:** S/M/L (with human and AI estimates) | **Why** | **Pros** | **Cons** | **Context** (date + source) | **Depends on** | **Added:** YYYY-MM-DD via <source>`. Keep all TODOs in a single `TODOS.md` at the repo root; resolved items are struck through with the resolution noted, not deleted.
<!-- scaffold:todos-format-reminder:6f0605ee -->
- Always update the help files after a modification to the UI or app behavior.
<!-- scaffold:help-files-update-rule:dab50972 -->
- Every bug fix must include a regression test at the lowest layer that would have caught it. Default to unit or component; only escalate to E2E if the bug is journey-shaped (multi-page, role-dependent, or session-state dependent).
<!-- scaffold:bug-fix-test-rule:d5ab7def -->
- When building or modifying a feature, update or create the matching `scenarios/<area>/SCN-*.md` BEFORE writing test code; then generate or update the Playwright spec from it. Scenarios are the source of truth.
<!-- scaffold:scenario-test-generation-rule:985cc8aa -->

<!-- scaffold:coding-discipline-rule:4d30b756 -->

## Coding Discipline

Four guardrails apply to every non-trivial coding task. They bias toward caution; on a one-line typo or obvious fix, use judgment.

### 1. Think before coding — surface, don't assume

- State assumptions in one line before implementing. If two interpretations exist, list both and ask — never pick silently.
- If a simpler approach would work, say so before writing the bigger one. Push back when warranted.
- If something is unclear, stop and name what's unclear. Hidden confusion produces wrong code faster than a question would.

### 2. Simplicity first — minimum code that solves the asked problem

- No features, flags, abstractions, or "configurability" beyond what was asked.
- No error handling for scenarios that cannot happen. Validate at boundaries (user input, external APIs, AI tool outputs); trust internal callers.
- No abstraction for single-use code. A class hierarchy, strategy pattern, or generic helper waits until there are at least two real call-sites.
- The check: would a senior engineer call this overcomplicated? If yes, rewrite shorter before shipping.

### 3. Surgical changes — every changed line traces back to the request

- Don't reformat, retype-hint, restyle, or "improve" code adjacent to the change. Match existing style even if you'd write it differently.
- Don't delete pre-existing dead code unless asked — flag it instead.
- Do remove imports, vars, and helpers that **your** change orphaned. Clean up your own mess, nothing else.
- Don't fold drive-by refactors into a bug-fix diff. If a refactor is worth doing, propose it as a separate change.

### 4. Goal-driven execution — declarative, verifiable, looped

- Translate imperative requests into a verifiable goal before coding:
  - "Fix the bug" → "Write a failing test that reproduces it, make it pass, no regressions."
  - "Add validation" → "Write tests for the invalid inputs, then make them pass."
  - "Refactor X" → "Test suite passes before and after, no behavior change."
- For multi-step work, write the plan as `Step → verify: <check>` lines, then loop until each `verify` passes.
- Strong success criteria mean you can loop independently. "Make it work" is not a success criterion.

### Source

Adapted from Andrej Karpathy's observations on LLM coding pitfalls (https://x.com/karpathy/status/2015883857489522876). Original CLAUDE.md by Forrest Chang at https://github.com/forrestchang/andrej-karpathy-skills (MIT).

<!-- scaffold:constitution-files-rule:fbf88d22 -->

## Constitution Files

This project carries five constitution files at the repo root:

- **PRODUCT.md** — strategic constitution: register, users, job to be done, voice, anti-patterns, accessibility floor.
- **ARCHITECTURE.md** — system overview, modules, auth, data, API, architectural patterns.
- **DESIGN.md** — visual + UX writing constitution: typography, color, spacing, motion, component patterns, absolute bans, UX writing.
- **SECURITY.md** — data classification (Tier 1/2/3), cardinal rule, auth, threat model, gaps and roadmap.
- **CONTRIBUTING.md** — engineering constitution: project conventions, common tasks, branch workflow.

### When to read

- **Before making a non-trivial change**, read the relevant constitution file(s). A change that touches data shapes reads ARCHITECTURE.md + SECURITY.md. A change that touches user-facing copy reads PRODUCT.md + DESIGN.md. A change that introduces a new dependency or convention reads CONTRIBUTING.md.
- **Before designing anything new**, read PRODUCT.md and DESIGN.md.

### When to update

- When you ship a change that contradicts what's documented in a constitution file, **update the file in the same PR**. The constitution is the source of truth — code and constitution must agree.
- The `Enforced by:` columns are not decorative. Each entry states what mechanism would catch drift. If the mechanism is `prompt`, the rule lives only in AI memory and the document; if it's `lint`, `type system`, `schema design`, or `code review`, you should be able to point at the actual enforcement path.
- New rules go in with their `Enforced by:` filled. Aspirational enforcement is allowed — flag it explicitly with `(aspirational)` and add it to the project's TODOs.

### Cross-references

The five files cross-reference each other by section name. Use that pattern: when you cite a rule from another file, name the file and the section. ("See DESIGN.md 'Absolute Bans'." / "Restated from SECURITY.md 'Cardinal Rule'.")

### Conflict between files

If two constitution files contradict each other, the conflict is a bug in the constitution. Surface it — do not silently follow one and ignore the other.

<!-- scaffold:canonical-stack:b5fbec9f -->

## Canonical Stack

This project commits to the following stack. Every feature decision starts here.

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router)** | Pages Router not supported. |
| Database | **Postgres-family** | Vanilla Postgres, Supabase, or Neon. Pick one and document in ARCHITECTURE.md §1. |
| ORM | **Drizzle** | After any schema change in `lib/db/schema.ts`, run `drizzle-kit push` immediately. |
| Auth | **NextAuth (Auth.js v5)** | Credentials, OAuth, magic-link — all supported. Custom auth requires explicit user approval. |
| Styling | **Tailwind CSS** | Use the design tokens from DESIGN.md. No raw hex in JSX. |
| UI primitives | **shadcn/ui (Radix-based)** | Add components via `npx shadcn@latest add <component>`. Don't hand-roll Dialog, Popover, Select, Combobox, etc. |
| Validation | **Zod** | At every boundary: route bodies, env vars, AI tool inputs, third-party responses. |
| Forms | **react-hook-form + Zod** | The standard pattern in this stack. |

### Behavioral rules

- When adding a UI component, check if shadcn has it before hand-rolling.
- When adding an auth flow, extend NextAuth — never roll a custom session.
- When proposing an alternative to anything in the table above, surface the reason and **ask the user before implementing**.
- When a feature genuinely needs something outside this stack, document the deviation in ARCHITECTURE.md "Decisions Log" with the reason, and update CONTRIBUTING.md if the deviation is durable.

### Deployment target

**Default:** Vercel. Override only with explicit user approval; document the actual target in ARCHITECTURE.md §1 if different.

<!-- scaffold:changelog-french:7a227e3d -->

## Changelog Guidelines

**IMPORTANT: CHANGELOG.md entries must be written in French**

When adding entries to CHANGELOG.md:
- Write all changelog entries in French (the target audience is French-speaking).
- Use French section headers: "Nouvelles fonctionnalités", "Corrections de bugs", "Modifications", "Améliorations".
- Keep commit messages in English (conventional commits), but translate the gist to French when adding to CHANGELOG.md.

Examples:
- English commit: "Add customer code search to Salesforce" → French changelog: "Ajout de la recherche par code client dans Salesforce"
- English commit: "Fix authentication error on mobile" → French changelog: "Correction de l'erreur d'authentification sur mobile"
- English commit: "Improve form validation" → French changelog: "Amélioration de la validation des formulaires"

<!-- scaffold:playwright-cleanup:e5122034 -->

## Playwright MCP Usage Guidelines

**IMPORTANT: Always close Playwright browser when done with UI testing**

### When to use Playwright MCP

- Only for active UI testing and browser automation.
- When you need to visually verify UI components.
- When you need to take screenshots of the application.

### When NOT to use Playwright

- For API testing (use curl or fetch instead).
- For running Playwright test suites (use `npx playwright test` directly).
- Don't leave Playwright sessions running in the background.

### Best Practices

1. Open browser only when needed for UI testing.
2. **ALWAYS** close browser when done: use `mcp__playwright__browser_close` tool.
3. Don't mix MCP Playwright with CLI Playwright in the same session.

### Cleanup (if browser gets stuck)

```bash
# Kill all Playwright processes
pkill -f "mcp-server-playwright"
pkill -f "ms-playwright/mcp-chrome"
```

<!-- scaffold:drizzle-migration-pattern:e2676982 -->

## Database Migration Guidelines

**IMPORTANT: Always follow this pattern for database schema changes**

We use TypeScript migration scripts with `@neondatabase/serverless` (or `drizzle-kit`) for direct SQL execution. Each migration is a standalone script in `scripts/`.

### Step-by-step migration process

1. **Create a migration script** at `scripts/migrate-<feature>.ts`:

```typescript
import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)

async function migrate() {
  try {
    console.log('Running <feature> migration...')
    console.log('='.repeat(80))

    // Migration body goes here

    console.log('='.repeat(80))
    console.log('Migration completed successfully!')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }
}

migrate()
```

2. **Create enums idempotently:**

```typescript
await sql`
  DO $$ BEGIN
    CREATE TYPE your_enum_type AS ENUM ('VALUE1', 'VALUE2');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;
`
```

3. **Add columns idempotently:**

```typescript
await sql`
  ALTER TABLE your_table
  ADD COLUMN IF NOT EXISTS your_column your_type
`
```

4. **Migrate existing data with CASE statements** when transforming a column.

5. **Drop old columns** only after data migration is verified.

6. **Run the migration:** `npx tsx scripts/migrate-<feature>.ts`

7. **Update `lib/db/schema.ts`:** add the enum type definition first, then update the table definition.

8. **Run `drizzle-kit push`** to confirm the schema is in sync.

### Common pitfalls

- Form field names vs database column names: keep `field_metadata` aligned with the form field naming, not the SQL column naming.
- Always run `drizzle-kit push` immediately after editing `schema.ts`. Without this, code that references new columns will silently fail at runtime.

<!-- scaffold:release-workflow:1020277f -->

## Release Workflow

**IMPORTANT: Always update these files when making notable changes:**

1. **CHANGELOG.md** — document all notable changes with the new version number under a dated heading.
2. **package.json** — bump the version using the right granularity:
   - Patch: `npm version patch --no-git-tag-version` (bug fixes, no feature changes)
   - Minor: `npm version minor --no-git-tag-version` (new features, backward compatible)
   - Major: `npm version major --no-git-tag-version` (breaking changes)
3. Verify both updates in the same commit; do not split CHANGELOG and package.json across commits.
4. After a release, push tags only after the deploy is green.

<!-- scaffold:testing-pyramid-policy:a9cfd399 -->

## Testing Pyramid Policy

Tests are organized in five layers. Use the cheapest layer that can catch the bug.

| Layer | Tool | Catches | When to use |
|-------|------|---------|-------------|
| Unit | Vitest | pure-function bugs, calc/format errors | Default for any logic without I/O or DOM |
| Component | Vitest + React Testing Library | validation states, conditional rendering, a11y | Anything that's a single component with props |
| Integration | Vitest + msw | API contract bugs, error handling | API client modules, server actions |
| E2E (smoke) | Playwright | "app loads, golden path works" | 5–10 specs total |
| E2E (critical journey) | Playwright | login, payment, multi-page form save, role-based access | One spec per user-shaped flow |

### Hard rules

- **No `waitForTimeout()`.** Use Playwright's auto-wait or explicit `expect(locator).toBeVisible()`.
- **User-facing selectors only.** Prefer `getByRole`, `getByLabel`, `getByPlaceholder`. CSS classes and DOM structure are forbidden as selectors.
- **One business objective per spec.** Long login-to-checkout E2E flows are decomposed into smoke (login still works) + integration (checkout API contract) + component (cart UI state).
- **Test isolation.** Each test gets its own fixtures. No shared accounts or DB rows. Parallel-safe by default.

### When a bug is found

The fix must include a regression test at the **lowest** layer that would have caught it. Default unit/component; only escalate to E2E if the bug is journey-shaped (multi-page, role-dependent, session-state dependent).

<!-- scaffold:scenario-driven-testing:094dff98 -->

## Scenario-Driven Testing

**Principle:** scenarios are the source of truth for E2E tests. Every feature has a scenario; every scenario has a Playwright spec generated from it; modifying a feature requires modifying the scenario *first*, then regenerating the spec.

### Format

Scenarios live in `scenarios/<feature-area>/SCN-NNN-kebab-title.md`. Numbering is project-wide and sequential. Folder grouping is by feature area.

A scenario file has YAML frontmatter (`id`, `title`, `area`, `status`, `last_synced`, `linked_spec`, `spec_hash`) and a body with these required sections: `## Actors`, `## Preconditions`, `## Happy path`, then any of `## Alternative path`, `## Edge case`, `## Out of scope`. See `scenarios/_TEMPLATE.md` for the canonical layout.

### The contract

1. Build or modify a feature → update or create the matching `scenarios/<area>/SCN-*.md` BEFORE writing test code.
2. Generate or update the Playwright spec at `e2e/scenarios/<area>/SCN-NNN.spec.ts`. The first line of the spec is `// scaffold:scenario:SCN-NNN:<hash>` where `<hash>` is the first 8 hex chars of sha256 of the scenario's body.
3. Update the scenario's frontmatter `spec_hash:` to the same hash.
4. Run `npx tsx scripts/check-scenario-drift.ts` to confirm sync. The CI test pipeline must run this script.

### Drift handling

If `check-scenario-drift.ts` reports drift on any scenario, the build fails. Two ways to resolve:
- **Scenario was the intended change.** Regenerate the spec from the scenario, update the hash in both places.
- **Spec was edited directly without scenario change.** Either revert the spec edit or update the scenario to match.

### Why this exists

E2E tests written ad-hoc drift away from product behavior over time. Tying every spec to a human-readable scenario, with a hash that fails the build on divergence, makes the spec unable to silently lie about what the feature does.
