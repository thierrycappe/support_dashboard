---
last_updated: 2026-05-06
sources:
  - app/page.tsx
  - app/api/feedback/ingest/route.ts
  - lib/db/schema.ts
  - lib/feedback/ingest.ts
---

# AI Memory — Overview

## What this project does

Support Control Tower is an authenticated dashboard that aggregates feedback tickets from multiple applications using the shared feedback-loop pattern. It receives normalized bug/evolution payloads from source apps, stores them by source app and external ticket ID, and gives support/product operators one open queue of links back to the original app dashboards.

## Key business rules

- Source apps send tickets through `POST /api/feedback/ingest` using `Authorization: Bearer SUPPORT_TOWER_INGEST_TOKEN`.
- Tickets are upserted by `(sourceAppId, externalId)` so repeated syncs update existing records instead of duplicating them.
- `ticket.url` is the deep link to the original feedback dashboard. Work happens there; the tower mirrors status after the source app sends another snapshot.
- Raw source payloads are retained in `feedback_tickets.raw_payload` for traceability.
- `DATABASE_URL` is required for runtime data access; without it, the dashboard renders a setup message.

## User roles

| Role | Description | Permissions |
|------|-------------|-------------|
| Admin | Product/support operator | View source apps, view open tickets, update status/priority through authenticated APIs |
| Source app | External application with feedback loop | Push ticket snapshots into the control tower via bearer-token API |

## Source Files

| File | Purpose |
|------|---------|
| `lib/db/schema.ts` | Drizzle schema for source apps, tickets, replies, notifications |
| `lib/feedback/ingest.ts` | Zod contract and upsert logic for incoming source app tickets |
| `app/api/feedback/ingest/route.ts` | Bearer-token API route used by source apps |
| `app/page.tsx` | Main control tower dashboard |
| `app/apps/page.tsx` | Connected source app overview |
