# Contributing

This document is the engineering working guide for this project and the engineering constitution every artefact this project produces inherits. It sits with PRODUCT.md (strategy), DESIGN.md (visual + UX writing), SECURITY.md (data policy), CLAUDE.md (AI behaviour), ARCHITECTURE.md (patterns).

The "Project conventions" section below is the rule-set; each rule ends with `Enforced by:`. The rest of the document is operational: how to set up the repo, run the dev server, add new features, and ship.

## Prerequisites

- `<runtime version>` (e.g., Node.js 20+, Python 3.12+)
- `<any required services>` (database, cache, search, etc.)
- `<any required API keys>`

## Local setup

```bash
cp .env.example .env.local    # Fill in credentials
<install command>              # e.g., npm install / uv sync / pip install -r requirements.txt
<schema sync command>          # e.g., npx drizzle-kit push / alembic upgrade head
<dev server command>           # e.g., npm run dev
```

Create your first admin user: state the procedure (registration endpoint + SQL promote, seed script, manual user creation, etc.).

## Project conventions

The rules below apply to this project and to every artefact it produces. The `Enforced by:` column tells a future agent what auditing path catches drift.

> **Enforcement reality check (YYYY-MM-DD).** State which `Enforced by:` paths exist today and which are aspirational. Update this note when enforcement reality changes. Tags marked `(aspirational)` below remain in the "not yet wired" bucket.

### Language and type system

| Rule | Detail | Enforced by |
|---|---|---|
| **Strict typing** | Strict mode in tsconfig (or equivalent). No exceptions per project; if a third-party library has weak types, narrow at the boundary, do not loosen the project. | `tsc --noEmit` (or `mypy --strict`) on every CI run |
| **No `any`** | Use `unknown` at boundaries and narrow with type guards. `any` is permitted only when a third-party type is broken upstream (with a justifying comment) or in test fixtures where exhaustive typing would obscure intent. | code review (lint rule aspirational) |
| **Runtime validation at every boundary** | `safeParse` / equivalent on every external input: API route bodies, query parameters, env vars, AI tool inputs, third-party API responses. Internal call sites trust their callers; do not re-validate inside the boundary. | code review + schemas colocated with each boundary |
| **Discriminated unions over flag-bag objects** | State machines, tool results, error vs success returns: prefer `{ ok: true, value } \| { ok: false, error }`. | type system + code review |
| **Shared types live in one place** | Cross-cutting types live in a single types module per domain, not duplicated across components. | code review |

### UI and text

| Rule | Detail | Enforced by |
|---|---|---|
| **No emojis in UI or AI-generated content** | Use icon library equivalents (Lucide-style line icons or inline SVG). Applies to this app's UI, generated artefacts, AI-streamed text, system-prompt examples, and toast/alert messages. | code review (regex lint sweep aspirational) |
| **DESIGN.md governs every visual decision** | Colors, spacing, typography, component shapes, motion. If a visual choice is not in DESIGN.md, add it there before shipping the code. Inventing tokens or shapes inline is forbidden. | code review |
| **Use design tokens, not hardcoded colors** | Hardcoded hex or `bg-gray-*` in JSX breaks dark mode and bypasses the token system. New code uses tokens; touched legacy code migrates. Known drift is tracked in DESIGN.md "Known Drift". | code review (regex lint aspirational) |

### API routes

| Rule | Detail | Enforced by |
|---|---|---|
| **Response shape is consistent** | One canonical shape for JSON responses, one for streaming. Mixed shapes within a single project are a bug. | code review |
| **Error handling pattern** | Try/catch around every route, log with a structured tag, return a user-locale message — never a stack trace. The error string is a recoverable next step (PRODUCT.md "Voice"), not a raw error. | code review |
| **Validation at the boundary** | Reject malformed input with a typed 400 before any side effect. | code review |
| **Auth boundary is explicit** | Each route declares its auth requirement with a single named call (`requireSession()`, `requireAdmin()`, `requirePublic()`). | code review |
| **Validation before authentication, when feasible** | Public endpoints validate body shape before checking auth. Avoids leaking auth state through differential error responses. | code review |

### State, storage, and side effects

| Rule | Detail | Enforced by |
|---|---|---|
| **Server-side first** | A new view starts on the server. Drop to client only when interactivity, browser-only APIs, or live state demand it. The directive is a deliberate decision, not a default. | code review |
| **No secrets in client code** | API keys, tokens, webhooks, signing keys live in env vars accessed server-side only. Client-prefixed env vars are for non-secret values. Anything sensitive is fetched server-side and proxied. | env review + naming convention |
| **State machines guard transitions** | Any process with more than two named states declares an explicit `assertTransition(from, to)`. Routes call the assertion before mutating; illegal transitions throw. | code review + unit tests on the transition table |
| **Versioning is immutable** | When user-visible artefacts mutate, the prior version is preserved as an immutable snapshot row, not overwritten. Audit and undo depend on this. | schema design + code review |

### Naming and file organization

| Rule | Detail | Enforced by |
|---|---|---|
| **kebab-case files, PascalCase components, camelCase functions** | `process-interview.tsx`, `ProcessInterview` (component), `extractFacts` (function). | code review |
| **Tests colocated with code** | A file `lib/foo.ts` is tested by `lib/__tests__/foo.test.ts` (or `lib/foo.test.ts`). Test names mirror the function under test. | code review |
| **Routes mirror URLs** | `app/api/foo/route.ts` is `<METHOD> /api/foo`. No nesting that hides the URL. Dynamic segments use the framework's convention. | framework convention |
| **One concern per module** | A file exports either pure functions, one component, one route, or one schema, not a mix. Helpers used by exactly one consumer live next to that consumer. | code review |

### Localization

(Delete this section if the project ships in a single locale.)

| Rule | Detail | Enforced by |
|---|---|---|
| **Every user-facing string passes through the translation system** | Even error messages from server actions and toast confirmations. Untranslated strings are a regression. | type system + code review |
| **Locales ship together** | A feature lands in all shipped locales at the same release, or it does not land. | code review |
| **Numbers and dates use `Intl.*`, never templates** | `new Intl.NumberFormat(locale, options).format(value)`, never string concatenation. Dates likewise. | code review (regex lint aspirational) |

## Common tasks

State the recipes for the most common changes. Each recipe is a short numbered list. Examples:

### Adding a new `<entity type>`

1. Modify schema in `<path>`.
2. Run the schema sync command.
3. Update types in `<path>`.
4. Add validation schemas at the boundary.
5. Update the relevant UI components.

### Database changes

1. Modify schema in `<path>`.
2. Run dev sync (`<command>`).
3. For production: generate a migration with `<command>`.

### Adding translations

State the procedure for adding a translation key in all shipped locales.

## Testing

```bash
<test runner>            # Run all tests
<test runner --watch>    # Watch mode
```

Tests live in `<path>`. Coverage focuses on `<what>`. Map-style configs that drive behaviour (status transitions, role gates) get a small fixture test asserting each entry's shape and the absence of orphaned keys. Tests assert on the shape of AI tool calls, never on the words the model returns.

## Code quality

```bash
<lint command>           # Lint
<typecheck command>      # Type check
<build command>          # Full production build
```

All three must pass before pushing. State whether a `pre-push` hook enforces this and how it's installed.

## Branch workflow

1. Create a feature branch from `main`: `feat/description` or `fix/description`.
2. Commit with Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. First line ≤ 72 chars; body explains *why*, not *what*. Atomic commits — one logical change per commit.
3. Push and create a PR.
4. CHANGELOG and version update with the PR. Patch (`x.y.z+1`) for fixes, minor (`x.y+1.0`) for features. The CHANGELOG entry describes the behaviour change a reader will notice, not the implementation.

## Key files to know

| What | Where |
|------|-------|
| Strategic constitution | `PRODUCT.md` |
| Design system | `DESIGN.md` |
| Security policy | `SECURITY.md` |
| Architecture patterns | `ARCHITECTURE.md` |
| AI behaviour | `CLAUDE.md` |
| Database schema | `<path>` |
| Auth config | `<path>` |
| Shared types | `<path>` |
