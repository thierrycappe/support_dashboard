# Enrolling a source app

Since the support-portal overhaul, enrolment is a **two-part** operation: an
administrator creates the application record in the UI, and a developer sets
the matching env vars. Neither half works alone.

Apps no longer self-register. `acceptLegacyPayload` throws
`configured source app is not registered` if no `source_apps` row matches the
slug, so a push before enrolment fails outright.

## Part 1 — create the record (UI)

`/apps` → **Enroll application**. Four steps: Application (name, stable slug,
base URL, environment) → Owners → Alerts (notification policy) → Invitation.

The slug is **locked after enrolment** and is the connector's identity. It must
match `^[a-z0-9][a-z0-9-]*$`, and avoid consecutive hyphens — see the round-trip
note below.

New apps are created with `credentialMode = LEGACY_BEARER`. The invitation
shown at the end is for the *optional* upgrade to public-key credentials; a
bearer app does not need to consume it to start sending.

**The invitation secret is displayed once and never stored** — only a hash and
prefix are kept. If it is lost, rotate rather than hunt for it.

## Part 2 — set the env vars

### Bearer apps (the default)

1. Generate a token: `openssl rand -hex 32`.
2. On the **tower**, add `SUPPORT_TOWER_INGEST_TOKEN_<SLUG>` (Encrypted), where
   `<SLUG>` is the slug upper-cased with non-alphanumerics turned into `_`.
   **Redeploy the tower** — env vars only apply on the next deploy, and this is
   the most common reason a correct token still returns 401.
3. On the **source app**, set `SUPPORT_TOWER_INGEST_TOKEN` to the same value,
   plus `SUPPORT_TOWER_BASE_URL` and `SUPPORT_TOWER_APP_SLUG`. Deploy.

The app's detail page shows both halves under **Connector wiring**, read from
the live environment.

### How the token is matched

The tower does **not** trust the slug in the payload. It scans every
`SUPPORT_TOWER_INGEST_TOKEN_*` var for one whose value equals the presented
token, requires exactly one match, and treats that as authoritative
(`getConfiguredAppSlugForIngestToken`). A payload whose `app.slug` disagrees
gets **409 Source app identity mismatch**, not 401.

Consequence: **the same token must not be reused across two apps** — two
matches resolve to `null` and both apps stop authenticating.

**Round-trip caveat.** The slug is recovered from the var name by lowercasing
and mapping `_` back to `-`. A slug with consecutive hyphens (`my--app`)
normalises to `MY_APP` and comes back as `my-app`, which never matches. The
detail page flags this.

## Part 3 — pull sync

Add the slug to `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` on the tower:

```json
{"<slug>": {"url": "https://<app>/api/support-tower/export", "token": "<export-token>"}}
```

This var holds **every** app — read the current value and merge, or the others
stop syncing. The export token is a separate secret the tower presents to the
app. Redeploy.

The cron (`*/30 * * * *`) runs a **full** sync, refreshing `lastSyncedAt` even
for unchanged tickets. Without it, open tickets show "Stale sync" after 48h
(`STALE_AFTER_HOURS`).

## Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <EXPORT_TOKEN>" \
  "https://<app>/api/support-tower/export"
```

`200` = pull works. `401` = export tokens differ. `404` = route not deployed.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `configured source app is not registered` | No enrolment record — do Part 1 first |
| 401 on push | Token not set on the tower, tower not redeployed, or the same token reused by two apps |
| 409 identity mismatch | The app's `SUPPORT_TOWER_APP_SLUG` differs from the slug that owns the token |
| Nothing arrives, no errors | App-side `SUPPORT_TOWER_BASE_URL` unset — sync skips silently |
| "Stale sync" after 48h | Slug missing from the pull JSON, or the export route is not 200 |
