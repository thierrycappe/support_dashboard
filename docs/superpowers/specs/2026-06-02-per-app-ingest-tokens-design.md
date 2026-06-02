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

Add a **per-app env var** lookup, keeping the legacy blob as a fallback. Chosen over a
DB-backed token management system because onboarding is rare and always performed by a
developer with Vercel access (YAGNI on UI / hashing / schema). The DB-management option
remains the documented future trigger if onboarding becomes frequent or delegated.

## Design

### Lookup precedence

`getIngestTokenForApp(appSlug)` in `lib/feedback/ingest.ts` resolves in this order:

1. **Per-app env var** (new, preferred)
2. **`SUPPORT_TOWER_INGEST_TOKENS_JSON`** blob (legacy, backward-compat)
3. **`SUPPORT_TOWER_INGEST_TOKEN`** singular (legacy)

The per-app var is checked and returned **before** the JSON is parsed, so a site
configured via per-app var is immune to a malformed legacy blob (no spurious 503).

### Slug → env key mapping

New exported pure helper:

```
ingestTokenEnvKey(slug) = "SUPPORT_TOWER_INGEST_TOKEN__" + slug.toUpperCase().replace(/-/g, "_")
```

Example: `pichon-bi-feedback` → `SUPPORT_TOWER_INGEST_TOKEN__PICHON_BI_FEEDBACK`.

Slugs match `^[a-z0-9][a-z0-9-]*$` (ingest schema, `lib/feedback/ingest.ts:99`), so they
never contain `_`; the `__` separator + transform is unambiguous and reversible.

### Migration behavior

Because per-app wins but the blob is still honored, the three existing apps
(`casal-track`, `csm-track`, `pitchme`) keep working unchanged on the legacy blob. No
forced rotation. They can be migrated to per-app vars individually later (tracked in
TODOS.md); once all are migrated the blob may be removed.

## Testing

Unit only (pure function, env injected) — `tests/unit/feedback-ingest.test.ts`. This is
not journey-shaped, so no E2E/Playwright scenario is added (per Testing Pyramid Policy).

- per-app var resolves
- per-app var takes precedence over the JSON blob
- per-app var resolves even when the JSON blob is malformed (no throw)
- falls back to the JSON blob when the per-app var is absent
- falls back to the singular var when neither is set
- `ingestTokenEnvKey` transforms hyphens and case correctly

## Immediate task — onboard `pichon-bi-feedback`

1. Generate token: `openssl rand -hex 32`.
2. Dashboard project: add `SUPPORT_TOWER_INGEST_TOKEN__PICHON_BI_FEEDBACK` as
   **Encrypted** (not Sensitive — editability requirement).
3. `pichon-bi-feedback` app: set `SUPPORT_TOWER_URL`, `SUPPORT_TOWER_APP_SLUG=pichon-bi-feedback`,
   `SUPPORT_TOWER_APP_NAME`, `SUPPORT_TOWER_INGEST_TOKEN=<token>`.
4. Deploy the dashboard (with the code change) and the source app.
5. First ingest auto-registers the `source_apps` row (`lib/feedback/ingest.ts:151-161`).

## Docs & release

- **SECURITY.md** — "Service-to-Service Ingest Auth": document the per-app var mechanism,
  precedence, and the Encrypted-vs-Sensitive trade-off (readable tokens are a slightly
  weaker posture, accepted for low-frequency solo onboarding).
- **ARCHITECTURE.md:67** — update the validation-rule description.
- **app/apps/page.tsx:76** — update the help text that references the JSON map.
- Help files updated per "always update help files after app-behavior changes".
- **CHANGELOG.md** (French) + **package.json** minor bump (backward-compatible feature).
- **TODOS.md** — narrow the existing entry to the future DB-management trigger.

## Security note (on the record)

Encrypted (readable) tokens can be read by anyone with Vercel project access — weaker
than Sensitive. Accepted trade-off for editability given "rare, just me" onboarding.
Documented in SECURITY.md.
