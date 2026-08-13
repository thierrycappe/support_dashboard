# Admin credential lifecycle report

Date: 2026-08-13

## Outcome

Administrators can now inspect application credential health, begin an assisted Ed25519 rotation from the application page, hand the resulting one-time challenge to the connector, and revoke a superseded credential after overlap. The administrator handles only the new public JWK and challenge. The private key remains connector-owned, and activation continues to use the existing connector-authenticated confirmation route and new-key signature proof.

The application page distinguishes active, overlap, pending, expired, and revoked credentials with text and color. Revocation keeps the last-active-key invariant, records the authenticated administrator in the credential row and append-only audit event, and returns fixed recovery messages without raw service errors or submitted key material.

## Security invariants

- The admin begin action accepts only a strict public Ed25519 JWK; private or extra JWK members are rejected.
- The confirmation challenge is returned once, stored only as a SHA-256 digest marker, and cleared from the browser component on `pagehide`.
- Admin assistance cannot activate a key. The connector must confirm through the unchanged proof route using the current credential and a signature from the new private key.
- Revoking the last active credential remains forbidden for an active application.
- Rotation and revocation audits use the authenticated administrator as a `USER` actor; audit metadata contains identifiers only.
- Browser-visible errors are fixed and sanitized.

## TDD evidence

RED covered the absent admin service, server actions, credential inventory, page boundary, responsive component, and real browser journey. A first browser pass also reproduced a timezone-dependent hydration mismatch; a focused regression drove deterministic UTC rendering before the clean browser rerun.

GREEN evidence:

- `npm run test:run` — 53 files, 388 tests passed.
- `TEST_DATABASE_URL=<approved isolated local test DB> npm run test:integration` — 17 files, 168 tests passed.
- Focused live PostgreSQL credential rotation — 27 tests passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `DATABASE_URL=<approved isolated local test DB> npm run build` — passed.
- `npm run scenario:check` — 10 scenarios in sync.
- `TEST_DATABASE_URL=<approved isolated local test DB> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3220 npx playwright test e2e/scenarios/control-tower/SCN-008.spec.ts --project=chromium --reporter=list` — setup plus journey, 2/2 passed; server log contained no hydration error.

## Browser acceptance

SCN-008 now uses the authenticated application page to submit the public JWK, reads the one-time challenge, confirms through the existing connector proof route, verifies both credentials are visibly active during overlap, revokes the old credential through the admin UI, and proves the old assertion fails while the new key remains usable.
