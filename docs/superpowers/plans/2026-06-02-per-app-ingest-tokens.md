# Per-App Ingest Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single Sensitive `SUPPORT_TOWER_INGEST_TOKENS_JSON` blob with one Encrypted env var per source app, so sites can be added/rotated independently and editably.

**Architecture:** `getIngestTokenForApp()` resolves a per-slug env var (`SUPPORT_TOWER_INGEST_TOKEN__<SLUG>`) and nothing else. The legacy JSON-blob and singular-token fallbacks, plus the route's invalid-JSON 503 branch, are removed. Spec: `docs/superpowers/specs/2026-06-02-per-app-ingest-tokens-design.md`.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Vercel env vars.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/feedback/ingest.ts` | token resolution | add `ingestTokenEnvKey()`, simplify `getIngestTokenForApp()` |
| `tests/unit/feedback-ingest.test.ts` | unit coverage | replace blob tests with per-app tests |
| `app/api/feedback/ingest/route.ts` | ingest endpoint | drop dead try/catch 503 branch |
| `.env.example` | config sample | replace blob var with per-app pattern |
| `SECURITY.md`, `ARCHITECTURE.md`, `app/apps/page.tsx` | docs/help | update mechanism description |
| `CHANGELOG.md`, `package.json`, `TODOS.md` | release | minor bump + French changelog + close TODO |

Migration of the four live Vercel projects is operational (Task 5), run after deploy.

---

## Task 1: Per-app token lookup (TDD)

**Files:**
- Modify: `lib/feedback/ingest.ts:245-262`
- Test: `tests/unit/feedback-ingest.test.ts:69-98`

- [ ] **Step 1: Replace the three blob-based tests with per-app tests**

In `tests/unit/feedback-ingest.test.ts`, delete the three `it(...)` blocks at lines 69-98 (`resolves per-app ingest tokens from the JSON token map`, `does not fall back...`, `falls back to the legacy shared token...`) and replace with:

```ts
  it('resolves the per-app ingest token from the slug-specific env var', () => {
    const token = getIngestTokenForApp('sales-portal', {
      SUPPORT_TOWER_INGEST_TOKEN__SALES_PORTAL: 'sales-token',
    })

    expect(token).toBe('sales-token')
  })

  it('returns null when no per-app token env var is set for the slug', () => {
    const token = getIngestTokenForApp('unknown-app', {
      SUPPORT_TOWER_INGEST_TOKEN__SALES_PORTAL: 'sales-token',
    })

    expect(token).toBeNull()
  })

  it('maps slugs to env keys by upcasing and replacing hyphens', () => {
    expect(ingestTokenEnvKey('pichon-bi-feedback')).toBe(
      'SUPPORT_TOWER_INGEST_TOKEN__PICHON_BI_FEEDBACK',
    )
    expect(ingestTokenEnvKey('csm')).toBe('SUPPORT_TOWER_INGEST_TOKEN__CSM')
  })
```

- [ ] **Step 2: Add `ingestTokenEnvKey` to the test's import**

In the import from `@/lib/feedback/ingest` at the top of the test file, add `ingestTokenEnvKey` to the named imports (alongside `getIngestTokenForApp`).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/feedback-ingest.test.ts`
Expected: FAIL — `ingestTokenEnvKey is not a function` / per-app assertions fail.

- [ ] **Step 4: Implement the per-app lookup**

In `lib/feedback/ingest.ts`, replace the whole `getIngestTokenForApp` function (lines 245-262) with:

```ts
export function ingestTokenEnvKey(appSlug: string): string {
  return `SUPPORT_TOWER_INGEST_TOKEN__${appSlug.toUpperCase().replace(/-/g, '_')}`
}

export function getIngestTokenForApp(
  appSlug: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env[ingestTokenEnvKey(appSlug)]?.trim() || null
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/feedback-ingest.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 6: Commit**

```bash
git add lib/feedback/ingest.ts tests/unit/feedback-ingest.test.ts
git commit -m "feat: resolve ingest tokens from per-app env vars"
```

---

## Task 2: Remove dead 503 branch in the ingest route

`getIngestTokenForApp` no longer throws, so the try/catch is dead code my change orphaned.

**Files:**
- Modify: `app/api/feedback/ingest/route.ts:27-35`

- [ ] **Step 1: Simplify the token resolution**

Replace lines 27-35:

```ts
  let expectedToken: string | null
  try {
    expectedToken = getIngestTokenForApp(parsed.data.app.slug)
  } catch {
    return NextResponse.json(
      { error: 'SUPPORT_TOWER_INGEST_TOKENS_JSON is invalid' },
      { status: 503 },
    )
  }
```

with:

```ts
  const expectedToken = getIngestTokenForApp(parsed.data.app.slug)
```

- [ ] **Step 2: Run the full unit suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/feedback/ingest/route.ts
git commit -m "refactor: drop dead invalid-JSON 503 branch from ingest route"
```

---

## Task 3: Update docs and help text

**Files:**
- Modify: `SECURITY.md:101-108`, `ARCHITECTURE.md:67`, `app/apps/page.tsx:74-81`, `.env.example:8-13`

- [ ] **Step 1: SECURITY.md — replace the preferred-config bullet**

In the "Service-to-Service Ingest Auth" list, replace the `Preferred configuration: SUPPORT_TOWER_INGEST_TOKENS_JSON ...` bullet with:

```markdown
- Configuration: one **Encrypted** env var per source app, named
  `SUPPORT_TOWER_INGEST_TOKEN__<SLUG>` (slug upper-cased, hyphens → underscores).
  Encrypted rather than Sensitive so a token can be read/rotated without
  reconstructing the whole set — a deliberate trade-off (any Vercel project
  member can read tokens) accepted because onboarding is rare and developer-only.
```

- [ ] **Step 2: ARCHITECTURE.md — update the validation rule (line 67)**

Replace:
```markdown
- Validation rules: token must match the per-app entry in `SUPPORT_TOWER_INGEST_TOKENS_JSON`.
```
with:
```markdown
- Validation rules: token must match the per-app env var `SUPPORT_TOWER_INGEST_TOKEN__<SLUG>` for the submitted `app.slug`.
```

- [ ] **Step 3: app/apps/page.tsx — update the connector-contract help (line 76)**

Replace `matched to \`app.slug\` through \`SUPPORT_TOWER_INGEST_TOKENS_JSON\`, so` with:
```tsx
            matched to `app.slug` through a per-app env var
            (`SUPPORT_TOWER_INGEST_TOKEN__&lt;SLUG&gt;`), so
```

- [ ] **Step 4: .env.example — replace the blob lines (8-13)**

Replace lines 8-13 (the `SUPPORT_TOWER_INGEST_TOKENS_JSON` comment+var and the singular `SUPPORT_TOWER_INGEST_TOKEN` comment+var) with:

```bash
# One Encrypted token per source app: SUPPORT_TOWER_INGEST_TOKEN__<SLUG>
# (slug upper-cased, hyphens -> underscores). Generate with: openssl rand -hex 32
SUPPORT_TOWER_INGEST_TOKEN__CSM=
SUPPORT_TOWER_INGEST_TOKEN__CASAL_TRACK=
SUPPORT_TOWER_INGEST_TOKEN__PITCHME=
SUPPORT_TOWER_INGEST_TOKEN__PICHON_BI_FEEDBACK=
```

(Leave `SUPPORT_TOWER_SOURCE_APP_URLS_JSON` and `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` unchanged — different features.)

- [ ] **Step 5: Commit**

```bash
git add SECURITY.md ARCHITECTURE.md app/apps/page.tsx .env.example
git commit -m "docs: document per-app ingest token env vars"
```

---

## Task 4: Release bookkeeping

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `TODOS.md`

- [ ] **Step 1: Bump the minor version**

Run: `npm version minor --no-git-tag-version`
Expected: version becomes `0.3.0`.

- [ ] **Step 2: Add the French changelog entry**

Insert directly under the `# Changelog` heading in `CHANGELOG.md`:

```markdown
## [0.3.0] - 2026-06-02

### Modifications

- Remplacement de la table de jetons unique `SUPPORT_TOWER_INGEST_TOKENS_JSON` par une variable d'environnement chiffrée par application source (`SUPPORT_TOWER_INGEST_TOKEN__<SLUG>`). Un site peut désormais être ajouté ou renouvelé indépendamment, sans reconstruire l'ensemble des jetons.
```

- [ ] **Step 3: Close the per-app migration in TODOS.md**

In `TODOS.md`, strike through the per-app-var portion of the existing entry and leave only the future DB-management trigger open. Replace the entry body with a struck-through resolved line noting "résolu 2026-06-02 — migré vers `SUPPORT_TOWER_INGEST_TOKEN__<SLUG>`", and add a new open P2 entry capturing only: "Build a DB-backed token management UI **if** onboarding becomes frequent or delegated to non-developers" (same shape: Priority/Effort/Why/Pros/Cons/Context/Depends on/Added).

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md TODOS.md
git commit -m "chore: release 0.3.0 — per-app ingest tokens"
```

---

## Task 5: Migration runbook (operational — run after the code is deployed)

> Manual Vercel/CLI operations across four projects. Not code. The CLI is authed as the
> gmail account; each `vercel env add` marks the var Encrypted (do NOT check Sensitive).
> Token mismatch causes a brief 401 window per app between dashboard cutover and that
> app's redeploy — acceptable for async, low-traffic ingest.

- [ ] **Step 1: Generate four tokens** — `for n in csm casal-track pitchme pichon-bi-feedback; do echo "$n: $(openssl rand -hex 32)"; done` (keep them; Encrypted means you can also re-read later).
- [ ] **Step 2: Dashboard — add four Encrypted Production vars:** `SUPPORT_TOWER_INGEST_TOKEN__CSM`, `__CASAL_TRACK`, `__PITCHME`, `__PICHON_BI_FEEDBACK`, each = its token.
- [ ] **Step 3: Deploy the dashboard** from the merged branch (picks up the new code + new vars).
- [ ] **Step 4: Rotate each existing source app** (`csm-track`, `casal-track`, `pitchme`): overwrite its own `SUPPORT_TOWER_INGEST_TOKEN` with the matching new token; redeploy. Do all three promptly after Step 3.
- [ ] **Step 5: Configure `pichon-bi-feedback`** app: set `SUPPORT_TOWER_URL` (the dashboard URL), `SUPPORT_TOWER_APP_SLUG=pichon-bi-feedback`, `SUPPORT_TOWER_APP_NAME`, `SUPPORT_TOWER_INGEST_TOKEN=<token4>`; deploy. First ingest auto-registers its `source_apps` row.
- [ ] **Step 6: Verify** each of the four can POST `/api/feedback/ingest` and gets `201/200` (not 401).
- [ ] **Step 7: Delete the legacy var** `SUPPORT_TOWER_INGEST_TOKENS_JSON` (and `SUPPORT_TOWER_INGEST_TOKEN` singular if present) from the dashboard project. No redeploy needed — the code no longer reads them.

---

## Self-Review

- **Spec coverage:** single-mechanism lookup (T1), removals incl. 503 branch (T1/T2), all-four migration + blob deletion (T5), unit tests (T1), SECURITY/ARCHITECTURE/help/.env docs (T3), CHANGELOG/version/TODOS (T4), security note (T3 Step 1). All covered.
- **Placeholders:** none — every code/edit step shows exact content.
- **Type consistency:** `ingestTokenEnvKey(appSlug: string): string` and `getIngestTokenForApp(appSlug, env?)` names/signatures match between `ingest.ts` and the test imports.
