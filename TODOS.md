# TODOS

## Open

### Build a DB-backed ingest-token management UI — only if onboarding scales

**Priority:** P2 | **Effort:** L (human ~1-2d; AI ~half day for schema+UI+tests) | **Why:** Per-app env vars (current mechanism) require Vercel access and a redeploy to add/rotate a site. If source-app onboarding becomes frequent or is delegated to non-developers, a dashboard-managed token store (hashed at rest, add/rotate/revoke UI, audit trail) becomes worth the cost. | **Pros:** self-service, no redeploy, no Vercel access, tokens hashed (stronger than readable env vars), audit trail. | **Cons:** real feature — schema + migration, token hashing (Tier 1 per SECURITY.md), shadcn UI, display-once-at-creation UX, NextAuth role gating, more attack surface. | **Context:** 2026-06-02 — deferred during the per-app-env-var migration as the explicit future trigger. | **Depends on:** a real signal that onboarding cadence/ownership has changed (do not build speculatively). | **Added:** 2026-06-02 via chat (ingest-token session)

## Resolved

- ~~Replace single-JSON ingest-token blob with per-app env vars~~ — **résolu 2026-06-02**: `getIngestTokenForApp` now resolves a single per-app Encrypted var `SUPPORT_TOWER_INGEST_TOKEN_<SLUG>`; the `SUPPORT_TOWER_INGEST_TOKENS_JSON` map and singular `SUPPORT_TOWER_INGEST_TOKEN` fallback were removed. Spec: `docs/superpowers/specs/2026-06-02-per-app-ingest-tokens-design.md`.
