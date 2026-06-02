---
id: SCN-004
title: Manual refresh of a single ticket from its source app
area: control-tower
status: active
last_synced: 2026-05-12
linked_spec: e2e/scenarios/control-tower/SCN-004.spec.ts
spec_hash: dcead3ab
---

# SCN-004 — Manual refresh of a single ticket from its source app

## Actors

- Support dashboard admin
- Source application exposing the pull endpoint described in SCN-003

## Preconditions

- The admin is authenticated.
- The ticket exists in the control tower.
- `SUPPORT_TOWER_SOURCE_APP_PULL_JSON` is configured for the ticket's source app slug.

## Happy path

1. The admin opens the detail page of a ticket whose source app has a pull config → the "Refresh from source" button renders in the Context panel.
2. The admin clicks the button → the browser issues `POST /api/feedback/[id]/refresh`.
3. The route fetches the configured pull URL with `?externalId=<id>`, validates the response, and upserts the returned payload via `ingestFeedbackTicket` → the ticket row is updated with the source app's current state.
4. The page revalidates → the topbar reflects the new status and the stale badge clears if the new sync is fresh.

## Alternative path: no pull config for the source app

1. The admin opens a ticket whose source app has no pull entry → the "Refresh from source" button is not rendered.

## Edge case: source app returns no ticket

1. The pull endpoint responds with `{ tickets: [] }` for the requested externalId → the route returns 404 and the page surfaces the error message under the button.

## Edge case: upstream failure

1. The pull endpoint returns 5xx or throws → the route returns 502 with the error message; the UI surfaces it under the button and leaves the existing ticket data untouched.

## Out of scope

- Refreshing more than one ticket in a single request (use the cron in SCN-003).
- Letting unauthenticated callers trigger refreshes.
