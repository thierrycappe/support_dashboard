# TODOS

## Open

No open implementation backlog is recorded for the 0.4.0 support portal
overhaul. Production enablement still requires the operator to confirm that the
deployed `DATABASE_URL` is the provider's pooled endpoint and that
`DATABASE_POOL_MAX` fits the provider connection budget.

## Resolved

- ~~Complete the 0.4.0 production-readiness gate~~ — **resolved 2026-08-13**:
  the ordered verifier passed all ten gates against a fresh marked local
  PostgreSQL database. The burst accepted 500 unique escalations and 50
  duplicate replays with no failures or missing work; intake p95 was 305 ms and
  first-attempt p95 was 352 ms.
- ~~Build a DB-backed ingest-token management UI~~ — **superseded 2026-08-13**:
  administrator-approved one-time enrollment, connector-owned Ed25519 keys,
  portal-managed pause/revoke, and verified seamless rotation replace the old
  shared-token UI proposal.
- ~~Replace single-JSON ingest-token blob with per-app env vars~~ — **résolu 2026-06-02**: `getIngestTokenForApp` now resolves a single per-app Encrypted var `SUPPORT_TOWER_INGEST_TOKEN_<SLUG>`; the `SUPPORT_TOWER_INGEST_TOKENS_JSON` map and singular `SUPPORT_TOWER_INGEST_TOKEN` fallback were removed. Spec: `docs/superpowers/specs/2026-06-02-per-app-ingest-tokens-design.md`.
