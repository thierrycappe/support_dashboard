# Security Model

Last updated: 2026-05-06

Sits with PRODUCT.md (strategy), ARCHITECTURE.md (patterns), DESIGN.md (visual + UX writing), CONTRIBUTING.md (engineering), CLAUDE.md (AI behaviour). The Cardinal Rule (§2) and Data Classification (§1) are referenced from PRODUCT.md and ARCHITECTURE.md by section name.

One paragraph: what the system is, who can use it, and where it is deployed. This document describes the security architecture, data handling policies, known limitations, and planned improvements.

---

## 1. Data Classification

State which data categories the system handles and which it must never handle. The Tier 1 / Tier 2 / Tier 3 model below is a starting point — adjust to your context.

### Tier 1 — Never Stored

The following data categories must never enter the system. Enforcement mechanisms exist at multiple levels to prevent it.

- **Production credentials**: passwords, API keys, tokens for any internal or partner system.
- **Production data**: real customer records, transactional data, anything that could identify a real person or transaction outside this system.
- **Connection strings**: JDBC/ODBC URLs, internal hostnames, VPN endpoints.
- **Personal data beyond name/email**: government IDs, salary, medical, home addresses — unless the product explicitly requires them and a separate compliance review has happened.

(Edit this list to match your project's threat model. Be specific: name the systems, name the data shapes.)

### Tier 2 — Stored, Protected

Data the application stores, protected by authentication.

- **User accounts**: name, email, hashed password, role.
- **Application data**: list the major data domains the app stores (specs, history, results, etc.).
- **Audit / log data**: what is logged, retention period.

### Tier 3 — Public

Data intentionally accessible without authentication, if any.

- **Deployed artefacts**: e.g., shareable URLs, public OG images, RSS feeds.
- **Public metadata**: anything exposed via public endpoints.

(If the system has no Tier 3 data, replace this section with a single sentence stating that.)

---

## 2. The Cardinal Rule

Every project has a single firm constraint that, if violated, breaks the security posture. State it in one sentence, then list the layers that enforce it.

**`<Cardinal rule for this project>`**

(Examples: "Generated code must never connect to production systems." / "User-uploaded files are never executed server-side." / "Customer PII never leaves the EU region." / "The AI model never receives the user's password or session token.")

### Enforcement Layers

Document each layer that enforces the cardinal rule. Each layer is one of: prompt, type system, schema constraint, lint rule, runtime check, code review, manual audit. State for each whether it is **shipping today** or **aspirational**.

**Layer 1 — `<name>` (status: shipping | aspirational)**

Where it lives, what it checks, what it blocks.

**Layer 2 — `<name>` (status: shipping | aspirational)**

…

### Honest Limitation

Every enforcement story has gaps. State them explicitly. ("All four layers are behavioral enforcement via LLM prompting; no static analysis runs against generated artefacts. A sufficiently creative prompt injection could…")

---

## 3. Authentication Architecture

The dashboard uses Auth.js with a credentials provider backed by the
`support_users` database table. There is no public registration flow. Admins
create support users from `/users`.

### Admin Login

- Route: `/login`
- Provider: Auth.js credentials provider
- Allowed users: active rows in `support_users`.
- Bootstrap admin: `SUPPORT_DASHBOARD_ADMIN_EMAILS` plus
  `SUPPORT_DASHBOARD_ADMIN_PASSWORD_HASH` can seed or authenticate the first
  admin account.
- Password storage: per-user scrypt password hashes in `support_users.password_hash`.
- Hash format: `scrypt-v1$N$r$p$salt$hash`, currently generated with `N=16384`,
  `r=8`, `p=1`, 64-byte derived keys, and random salts.
- Plaintext fallback: `SUPPORT_DASHBOARD_ADMIN_PASSWORD` is accepted only outside
  production for local development.
- Login throttling: failed admin login attempts are recorded in
  `auth_login_attempts`; five failed attempts within 15 minutes block the email
  or IP address for the window.

### Session Lifetime

- Strategy: Auth.js JWT session.
- Maximum age: 8 hours.
- Update age: 1 hour.
- Logout: `/login` sign-out action invalidates the session and redirects to login.

### Service-to-Service Ingest Auth

- Route: `/api/feedback/ingest`
- Authentication: `Authorization: Bearer <token>`
- Preferred configuration: `SUPPORT_TOWER_INGEST_TOKENS_JSON`, a per-source-app
  token map keyed by app slug.
- Token comparison: constant-time comparison after resolving the expected token
  for the submitted app slug.

### Authorization Model

Dashboard roles:

- `ADMIN`: full dashboard access plus support-user CRUD at `/users`.
- `SUPPORT`: dashboard and feedback queue access, no user-management access.

Page access is enforced with `auth()` checks in server components and route
handlers. The ingest endpoint is excluded from page-session auth and uses its
own bearer-token check.

---

## 4. Data Flow to Third Parties

For every external service the system talks to, document:

- Which data fields are sent.
- Whether the data is logged on the third-party side.
- Retention policy.
- Whether the user is informed.

(AI providers, analytics, error reporting, deployment, payment processors, email senders, etc. List every one.)

### Pushover

- Purpose: instant notification when a new mirrored ticket appears.
- Data sent: ticket title, source app name, kind, priority, status, reporter
  name/email when present, and the source/tower links.
- Configuration: `PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`.

### Resend

- Purpose: daily open-ticket digest email.
- Data sent: open ticket counts, app names, top queue titles/statuses/priorities,
  and the Support Tower link.
- Configuration: `RESEND_API_KEY`, `RESEND_FROM`, optional
  `SUPPORT_TOWER_DIGEST_EMAIL_TO`.

---

## 5. Application Security

| Topic | Position | Notes |
|---|---|---|
| Input validation | Validate every external input at the boundary with a runtime validator. | Trust internal call sites. |
| SQL injection | Parameterized queries / ORM only. Never string-concatenate user input into SQL. | |
| XSS | Framework default (auto-escaping). For raw HTML injection APIs, always sanitize via a vetted library. | |
| CSRF | Same-site cookies + token verification on state-changing requests. | |
| File uploads | Validate type and size at the boundary. Store outside the web root. Never execute. | |
| Rate limiting | Per-IP and per-user limits on auth endpoints, AI endpoints, file uploads. | |
| Logging | No secrets, no PII beyond user ID. Structured logs with severity. | |

---

## 6. Secrets Management

- Where secrets live (env vars, secret manager, etc.).
- The rule for which are server-only vs which can be client-side.
- Rotation cadence and procedure.
- Who has access to production secrets.

---

## 7. Known Security Gaps and Roadmap

Append-only list of gaps and the plan to close each one. Each entry: gap, severity (critical / high / medium / low), planned mitigation, owner, target date.

| Gap | Severity | Mitigation | Owner | Target |
|---|---|---|---|---|
| (none yet) | | | | |

This section is the project's honest self-assessment. Filling it in builds trust; leaving it empty does not.
