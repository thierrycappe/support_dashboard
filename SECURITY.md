# Security Model

Last updated: 2026-08-13

Support Control Tower is an internal, authenticated portal deployed as a
Next.js application with PostgreSQL. Human access is limited to provisioned
support/admin users. Source applications use administrator-approved enrollment
and public-key credentials; legacy per-app bearer ingest remains only as a
compatibility path. This document defines data handling, trust boundaries,
third-party disclosure, and known gaps.

## 1. Data Classification

### Tier 1 — Never stored in application tables or logs

- Plaintext human passwords, Auth.js secrets, database connection strings, cron
  secrets, provider API keys, channel encryption keys, or service-token signing
  private keys.
- A source application's Ed25519 private key. The connector creates and retains
  it; the tower accepts only the public JWK.
- Plaintext enrollment invitation secrets, password-reset tokens, or credential
  rotation challenges after one-time display. The database stores digests.
- Plaintext email, Pushover, or webhook channel configuration. Database-backed
  channel configuration is encrypted before persistence; the legacy Pushover
  bridge reads secrets from server environment variables.
- Raw access tokens, client assertions, bearer tokens, decrypted channel
  configuration, or outbound authorization/signature headers in audit metadata.
- Customer transactional records unrelated to an approved feedback escalation.

### Tier 2 — stored and protected

- Human accounts: name, email, role, status, scrypt password hash, last login,
  login-attempt IP/user-agent evidence, and password-reset metadata.
- Application identity: name, environment, base URL, ownership, lifecycle,
  enrollment state, public keys/thumbprints, invitation/token/challenge digests,
  rate-limit buckets, and credential validity/revocation dates.
- Approved feedback: title, description, classification, priority, mirrored
  status, business-owner triage evidence, reporter name/email/source ID,
  browser context, source URL, transcript/specification, source timestamps, and
  normalized raw command data.
- Routing and delivery: group membership, policy, redacted destination,
  encrypted channel configuration, immutable minimized payload, state,
  provider status/message ID, sanitized error class, attempts, and incidents.
- Audit evidence: actor/subject identifiers, action, correlation ID, and
  non-secret metadata.

All Tier 2 portal reads require an authenticated session. Reporter context is
not rendered into delivery payloads by default and can be enabled only on an
authenticated database-backed channel.

### Tier 3 — public

The system publishes no support data. Public service endpoints return only
protocol responses and stable error envelopes. Enrollment and token exchange
responses are `no-store`; possessing a valid one-time invitation or key proof is
still required.

## 2. Cardinal Rule

**An escalation reaches central support only after canonical business-owner
approval, and its application identity always comes from verified credentials,
never from an untrusted payload field.**

### Enforcement layers

- **Contract and route boundary (shipping):** the versioned schema requires a
  strict `triage` object, rejects unknown fields and oversized bodies, and
  derives `appId` from the scoped access token. The legacy adapter binds a
  configured slug before normalization.
- **Credential verification (shipping):** Ed25519 assertions pin algorithm,
  key ID, issuer, subject, audience, scope, age, expiry, and JTI. Replay markers,
  credential status, application lifecycle, and database rate limits are
  checked server-side.
- **Canonical queries (shipping):** operator escalation pages query only tickets
  with valid stored triage approval. Direct unapproved detail URLs return 404.
- **Atomic persistence (shipping):** receipt, ticket, immutable event, routing
  result, outbox, and audit commit in one PostgreSQL transaction.
- **Verification (shipping):** unit and live-PostgreSQL tests cover identity
  binding, approval, replay, rate limits, invitation consumption, rotation,
  idempotency, transaction rollback, routing, and delivery recovery.

### Honest limitation

The legacy bearer adapter synthesizes `legacy-source` triage because older
connectors cannot express the new approval evidence. It is restricted to
explicitly configured app credentials and passes through the durable intake,
but it cannot provide the same human-owner attribution as version 1. New app
connections must use public-key enrollment.

## 3. Authentication and Authorization

### Human sessions

- Auth.js credentials provider backed by active `support_users` rows.
- Scrypt hashes use the versioned `scrypt-v1$N$r$p$salt$hash` format; plaintext
  bootstrap fallback is development-only.
- JWT session maximum age is eight hours and update age is one hour.
- Five failed attempts within 15 minutes block the email or IP for that window.
- `ADMIN` manages applications, enrollment, technical groups, channels, and
  users. `SUPPORT` reads and operates the support/delivery queues.
- Server components, actions, and route handlers enforce authorization at the
  boundary; navigation visibility is not treated as access control.

### Application enrollment

- Admin creates the application and a 32-byte random invitation that expires in
  30 minutes and is shown once. Only its SHA-256 digest is stored.
- Exchange is allowed once, atomically, while app and grant remain eligible.
  Invitation and trusted Vercel client-IP limits are consumed transactionally.
- Connector sends its public Ed25519 JWK plus connector version, environment,
  and base URL. It never sends its private key.

### Service tokens

- A connector signs a client assertion with its active key. Assertions expire
  within 60 seconds and each `(credential, jti)` can be accepted once.
- The tower returns a five-minute EdDSA bearer access token with explicit
  `escalations:write` and/or `credentials:rotate` scopes.
- Credential state and app binding are re-read when the access token is used;
  revocation therefore takes effect without waiting five minutes.
- Token exchange permits 60 requests/minute and a 10/second burst per
  credential. Escalation intake permits 120 requests/minute per app.

### Rotation and revocation

- Current-key proof authorizes a next public key. A digest-only five-minute
  challenge proves possession of the next private key before activation.
- Old and new keys may overlap for at most seven days. Admin revocation is
  immediate; an active app cannot lose its final active credential.
- Paused/revoked applications and expired/revoked credentials cannot obtain or
  use service authorization.

### Legacy ingest and pull

- `POST /api/feedback/ingest` uses one constant-time-compared bearer secret per
  configured app slug: `SUPPORT_TOWER_INGEST_TOKEN_<SLUG>`.
- Outbound source pull uses the per-slug URL/token map in
  `SUPPORT_TOWER_SOURCE_APP_PULL_JSON`; values are server-only. Pull responses
  pass the same ingest validation/normalization boundary.

## 4. Data Flow to Third Parties

Third-party provider logging and retention are governed by the organization's
account configuration and contract with that provider; this repository cannot
enforce them. Production owners must verify those settings and the applicable
DPA before enabling a channel. Users are informed operationally through the
configured channel/destination shown in the authenticated portal.

### Resend

Resend is used for three distinct flows:

- **Database email delivery:** recipient addresses from encrypted channel
  configuration; configured sender; subject containing priority and title; and
  text containing application name, kind, priority, title, and authenticated
  portal URL. Reporter name/email is added only when that channel's
  `includeReporterContext` flag is enabled.
- **Daily digest:** configured/admin recipient addresses, sender, open counts,
  application names/counts, up to six queue titles with priority/status, and the
  portal URL.
- **Password reset:** recipient name/email and a one-hour reset URL containing
  the one-time reset token.

Authentication uses `RESEND_API_KEY`; `RESEND_FROM` and optional
`SUPPORT_TOWER_DIGEST_EMAIL_TO` select sender/recipients. HTTP status and a
provider message ID may be retained. Durable escalation delivery stores only a
sanitized failure class. The older daily-digest and password-reset helpers log a
failed provider status and response body (or caught transport error); they do
not intentionally log the outbound message, but that broader error logging is a
known gap below.

### Pushover

Pushover receives its application token and user key, escalation title, source
application name, classification, priority, and authenticated portal URL. It
does not receive description, transcript, browser data, source URL, reporter
identity, or reporter email, even if upstream rendering accidentally includes
reporter context. HTTP status and Pushover request ID may be retained.

### Configured webhooks

The target receives a JSON delivery event containing ticket ID, application
name, kind, priority, title, and authenticated portal URL. Reporter name/email
is present only for a database-backed channel that explicitly opted in. Headers
include content type, immutable event idempotency key, timestamp, and an HMAC
SHA-256 signature. The signing secret is never in the body.

Webhook configuration requires HTTPS without credentials or a custom port.
Dispatch resolves and pins a public IP, blocks local/private/special-use
destinations, forbids redirects, and revalidates on every attempt to resist
DNS rebinding and SSRF. The shared address policy also denies non-global IPv6
space including `3fff::/20` and `5f00::/16`.

### Source application pull endpoints

For configured compatibility reconciliation, the tower sends an HTTPS `GET`
with the source app's bearer token. Targeted refresh adds only `externalId` as a
query parameter. Before attaching that bearer on every pull, the tower rejects
credentials/custom ports, resolves every hostname, rejects any
private/link-local/special-use answer, pins the approved public addresses while
retaining the original hostname for TLS SNI and certificate validation, and
forbids redirects. A 15-second deadline aborts stalled work; the streamed body
is capped at 1 MiB and 500 tickets, cancelled on overflow, and its pinned
dispatcher is destroyed when work cannot drain safely. DNS, transport, HTTP,
response, configuration, and per-ticket intake failures are reduced to fixed
classes; raw parser/provider/database errors are neither returned nor logged.
The source returns feedback ingest payloads. No portal user session, channel
secret, or unrelated application's data is sent.

### Vercel and PostgreSQL provider

Vercel runs the application and authorized cron requests; request metadata may
therefore be processed under the deployment account's configured logging and
retention. The PostgreSQL provider stores all Tier 2 records. Production must
use its pooled connection endpoint and transport security according to provider
policy. Neither deployment logs nor database query diagnostics may include raw
secrets or decrypted channel configuration.

## 5. Application Security Controls

| Topic | Shipping position |
|---|---|
| Input validation | Strict runtime schemas, streamed byte limits, JSON content type, bounded identifiers, and stable public errors at every public service boundary. |
| SQL injection | Drizzle/query parameter binding only; no request-derived SQL concatenation. |
| XSS | React escaping by default; no unsanitized raw HTML rendering of source content. |
| CSRF | Auth.js same-site session controls and server-side authorization guard human mutations; public service routes require non-cookie credentials. |
| Idempotency | App-scoped receipt digest prevents duplicate work and rejects key reuse with different content. |
| Rate limits | PostgreSQL-backed, concurrency-safe limits for enrollment, token exchange, and intake; login throttling is also persisted. |
| SSRF | Source detail URLs are display-hardened; webhook targets use HTTPS structural checks, DNS resolution, public-IP pinning, and redirect denial. |
| Delivery isolation | Provider calls occur after commit; leased claims, renewal, expiry, unique event-target generations, and ownership-checked finalization prevent loss/double completion. |
| Error handling | Public routes return correlation IDs and fixed messages. Delivery history stores provider status/message IDs and sanitized error classes, not response bodies or exceptions. |
| Audit | Enrollment, intake, routing/policy, retries, credential lifecycle, and admin changes append non-secret audit metadata. |

## 6. Secrets Management

- Production secrets live only in server-side deployment environment variables
  or encrypted database channel records. No secret uses a `NEXT_PUBLIC_` name.
- `SUPPORT_TOWER_CHANNEL_ENCRYPTION_KEYS_JSON` is a versioned AES-256-GCM
  keyring. The active key encrypts new config; older keys remain until every row
  using them is re-encrypted. Associated data binds channel ID, type, and key
  version.
- `SUPPORT_TOWER_ACCESS_TOKEN_PRIVATE_JWK` signs tower access tokens. Generate it
  with the repository command, restrict access, and rotate through a coordinated
  deployment because existing access tokens live at most five minutes.
- Invitation, reset, and rotation secrets are generated cryptographically,
  displayed/transmitted only when necessary, and represented by digests at rest.
- Channel/API/cron/database secrets must be rotated immediately after suspected
  disclosure. Audit the affected destination and delivery attempts without
  copying secret material into incident notes.
- Production access and rotation cadence are organizational controls; owners
  must document them in the deployment secret manager. This repository does not
  currently enforce a calendar cadence.

## 7. Production Database Prerequisite

Before enabling `/api/v1/**`, enrollment actions, routing mutations, or the
delivery cron on Vercel:

1. Confirm `DATABASE_URL` is the PostgreSQL provider's pooled endpoint.
2. Set `DATABASE_POOL_MAX` to a positive value within the provider/project
   connection budget; the application default is 5 per runtime instance.
3. Apply the additive migration and run the legacy-schema rehearsal twice
   against a disposable copy with representative rows.
4. Verify transaction, integration, browser, and burst gates before production
   traffic. A successful build alone does not satisfy this prerequisite.

## 8. Known Security Gaps and Roadmap

| Gap | Severity | Mitigation | Owner | Target |
|---|---|---|---|---|
| Legacy bearer ingest cannot prove a named business owner | Medium | Migrate each connector to public-key enrollment and version-1 triage; retain configured-slug binding until retirement. | Application owners | Per-app migration |
| Feedback and audit retention/deletion periods are not encoded | Medium | Approve retention periods, add bounded purge/export procedures, and test legal-hold exceptions. | Product + security | Before external reporter expansion |
| Secret access/rotation cadence is organizational, not enforced in code | Low | Record owners and rotation dates in the deployment secret manager; rehearse JWK and channel-key rotation. | Platform owner | Before production cutover |
| Digest/password-reset failure logging is less strict than durable delivery logging | Medium | Replace provider response bodies/raw caught errors with status and sanitized error classes. | Platform owner | Before production cutover |
