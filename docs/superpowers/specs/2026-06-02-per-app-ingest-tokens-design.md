# Per-app ingest token env vars — design

**Date:** 2026-06-02
**Status:** Approved (design)
**Area:** Service-to-service ingest auth

## Problem

Source-app ingest tokens are stored in a single `SUPPORT_TOWER_INGEST_TOKENS_JSON`
object on the dashboard, marked **Sensitive** (write-only) in Vercel. Because it is
both a single blob and write-only, adding or rotating one site forces rewriting the
entire object — which requires knowing every other app's token. Those tokens are also
Sensitive on each source app's side, so they cannot be read back anywhere. Net effect:
adding one new site (`pichon-bi-feedback`) would require rotating all existing apps.

## Decision

Replace the blob with **one Encrypted env var per app**, as the single mechanism. All
four sites (`casal-track`, `csm-track`, `pitchme`, `pichon-bi-feedback`) move to per-app
vars and the legacy `SUPPORT_TOWER_INGEST_TOKENS_JSON` blob and the singular
`SUPPORT_TOWER_INGEST_TOKEN` dashboard fallback are removed.

Chosen over a DB-backed token management system because onboarding is rare and always
performed by a developer with Vercel access (YAGNI on UI / hashing / schema). The
DB-management option remains the documented future trigger if onboarding becomes
frequent or delegated.

**Why migrate all four now (not just the new site):** leaving the 3 existing apps on the
blob would keep two token mechanisms alive indefinitely — a maintenance trap nobody
remembers in three months. Since the existing tokens are unreadable, migrating them means
rotating them; the blob would then be dead code, so it is deleted outright.

## Design

### Lookup — single mechanism

`getIngestTokenForApp(appSlug)` in `lib/feedback/ingest.ts` resolves **only** the per-app
env var:

```
ingestTokenEnvKey(slug) = "SUPPORT_TOWER_INGEST_TOKEN__" + slug.toUpperCase().replace(/-/g, "_")
return env[ingestTokenEnvKey(appSlug)]?.trim() || null
```

Example: `pichon-bi-feedback` → `SUPPORT_TOWER_INGEST_TOKEN__PICHON_BI_FEEDBACK`.

Slugs match `^[a-z0-9][a-z0-9-]*$` (ingest schema, `lib/feedback/ingest.ts:99`), so they
never contain `_`; the `__` separator + transform is unambiguous.

The function no longer parses JSON and no longer throws, so the route's
`try/catch` that returned a 503 `"SUPPORT_TOWER_INGEST_TOKENS_JSON is invalid"`
(`app/api/feedback/ingest/route.ts:27-35`) becomes dead and is removed. A missing/unknown
token resolves to `null` → existing 401 path (`route.ts:37`).

### Removed

- `SUPPORT_TOWER_INGEST_TOKENS_JSON` parsing in `getIngestTokenForApp`.
- `SUPPORT_TOWER_INGEST_TOKEN` singular fallback (dashboard receiver side).
- The 503 invalid-JSON branch in the ingest route.
- The dashboard env vars `SUPPORT_TOWER_INGEST_TOKENS_JSON` (and singular if present),
  deleted after cutover.

Note: each **source app** keeps its own outgoing `SUPPORT_TOWER_INGEST_TOKEN` (same name,
different project, different meaning — the token it sends). Unaffected by the above.

## Migration / rotation (all four apps)

This is a coordinated rotation. Per-app token mismatch causes a brief 401 window for an
app between dashboard cutover and that app's redeploy — acceptable for async, low-traffic
feedback ingest.

1. Generate four fresh tokens (`openssl rand -hex 32`).
2. Dashboard: add the four `SUPPORT_TOWER_INGEST_TOKEN__<SLUG>` vars as **Encrypted**.
3. Deploy the dashboard with the per-app-only code.
4. For each source app (`casal-track`, `csm-track`, `pitchme`): overwrite its
   `SUPPORT_TOWER_INGEST_TOKEN` with the matching new token; redeploy. Do these promptly
   after step 3 to minimise the 401 window.
5. New app `pichon-bi-feedback`: set `SUPPORT_TOWER_URL`,
   `SUPPORT_TOWER_APP_SLUG=pichon-bi-feedback`, `SUPPORT_TOWER_APP_NAME`,
   `SUPPORT_TOWER_INGEST_TOKEN=<token4>`; deploy. First ingest auto-registers its
   `source_apps` row (`lib/feedback/ingest.ts:151-161`).
6. Verify all four ingest successfully, then delete the legacy
   `SUPPORT_TOWER_INGEST_TOKENS_JSON` (and singular) from the dashboard.

## Testing

Unit only (pure function, env injected) — `tests/unit/feedback-ingest.test.ts`. Not
journey-shaped, so no E2E/Playwright scenario (per Testing Pyramid Policy). Update the
existing blob-based tests to the per-app mechanism:

- per-app var resolves the token
- absent var → `null`
- `ingestTokenEnvKey` transforms hyphens and case correctly
- (remove the obsolete JSON-blob and singular-fallback tests)

## Docs & release

- **SECURITY.md** — "Service-to-Service Ingest Auth": replace the JSON-map description
  with per-app Encrypted vars; add the Encrypted-vs-Sensitive trade-off note.
- **ARCHITECTURE.md:67** — update the validation-rule description.
- **app/apps/page.tsx:76** — update the help text that references the JSON map.
- **.env.example** — replace the blob var with the per-app pattern.
- Help files updated per "always update help files after app-behavior changes".
- **CHANGELOG.md** (French) + **package.json** minor bump (no external API change).
- **TODOS.md** — the per-app-var migration is now done; keep only the future
  DB-management trigger as an open item.

## Security note (on the record)

Encrypted (readable) tokens can be read by anyone with Vercel project access — weaker
than Sensitive. Accepted trade-off for editability given "rare, just me" onboarding.
Documented in SECURITY.md.
