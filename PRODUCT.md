# Product Foundation

Strategic constitution applied to every artefact this project produces. Sits with DESIGN.md (visual + UX writing), SECURITY.md (data policy), CONTRIBUTING.md (engineering), CLAUDE.md (AI behaviour), ARCHITECTURE.md (patterns). Each rule below ends with `Enforced by:` so a future agent can audit drift.

> **Enforcement reality (2026-08-13).** TypeScript, Drizzle constraints,
> runtime schemas, Vitest, live-PostgreSQL integration tests, scenario-drift
> checks, ESLint, production builds, authenticated Playwright journeys,
> migration rehearsal, the 500-escalation burst, and code review are active.
> The consolidated 0.4.0 verifier passed against disposable infrastructure.

## Register

Register: `internal-tool`.

This project is an internal support control tower for approved bugs and feature
requests from many applications. It is the technical support team's operational
queue for ownership, routing, delivery recovery, and audit evidence. Source
applications remain the reporter-facing systems and own their workflow status;
the tower does not become a customer helpdesk, marketing site, or public issue
tracker.

The capacity target is 100–500 newly connected applications per year, normally
20–50 approved escalations per day and at most 500 on a launch day. Enrollment
therefore cannot require a portal redeployment, and alert delivery cannot rely
on one in-request provider call.

## Users

Every source application has a non-technical business owner who receives raw
reporter feedback first, filters noise, and escalates only a true bug or feature
request with canonical triage attribution. That two-tier boundary prevents the
central team from becoming the first-line inbox.

Primary portal users are technical support operators and builder-admins. They
work mostly on desktop, scan dense queues repeatedly, need app ownership and
delivery health at a glance, and need authenticated source/reporter context for
diagnosis.

Secondary users are source-app maintainers. An admin invites their application;
the connector generates its own key, enrolls without sharing a private key,
rotates credentials without coordinated downtime, and submits the versioned
escalation contract. Any external reporter-facing surface remains a separate
product decision.

## Job to Be Done

Primary job: accept only business-owner-approved bugs and feature requests,
persist acceptance and delivery work atomically, route each escalation to the
application's technical owner with central fallback, and let support recover
failed delivery without losing source context.

Success is observable when an administrator enrolls an application with a
one-time invitation; its connector exchanges an Ed25519 assertion for a
short-lived scoped token; a versioned, idempotent escalation is accepted once;
the approved ticket, immutable event, routes, outbox work, and audit evidence
commit together; the queue shows the correct application/owner; and retryable
provider failures recover visibly. Legacy push and full pull remain compatible
through the same durable intake while applications migrate.

The product is not successful if an unapproved ticket appears in central
queues, an app can claim another app's identity, an accepted escalation lacks
delivery work or a visible routing incident, a provider error changes source
status, or reporter context leaves through a channel that did not opt in.

| Rule | Detail | Enforced by |
|---|---|---|
| **One primary action per screen** | A "screen" is one route or one tab inside a tabbed route. Secondary actions live behind progressive disclosure. | prompt + design-review |
| **First-paint contract** | The user must see real data, not a skeleton or empty hero, within 1s of route mount. Loading shells are permitted only for streamed/async content. | prompt |
| **Realistic, fictional mock data** | Plausible names, addresses, vocabulary, volumes — locale-correct. **No** real customer / employee / supplier / production identifiers. **No** `Lorem ipsum` or `John Doe`. If realistic data cannot be invented, the AI asks for a sample. | prompt + SECURITY.md tier-1 |
| **Empty states teach** | Every empty state answers two questions: why empty + what triggers an entry. A bare "No data" is a regression. | prompt + DESIGN.md component spec |
| **Every interaction acknowledges itself** | Click confirmation, save toast, validation error, undo affordance. Silent UIs are broken UIs. | prompt + DESIGN.md component spec |

## Voice

Three operational rules, not adjectives:

| Rule | Detail | Enforced by |
|---|---|---|
| **Confirmations state facts, not encouragements** | "3 rows added" / "Status updated". Never "Bravo!", "Great question!", "Excellent!". Exclamation marks appear only in confirmed-success states, never as default punctuation. | prompt + lint (regex sweep over UI strings) |
| **No greeting theatre** | App shells, dashboards, and admin pages do not greet the user ("Welcome back, {name}!", "How can I help today?"). The header carries identity; the body carries work. | prompt + design-review |
| **Buttons are verb + noun** | "Archive prototype", "Generate password", "Export to CSV". Never bare verbs ("OK", "Submit", "Click here") or marketing imperatives ("Discover!"). | prompt + design-review |

The full UX-writing rule set (rename table, confirmation pattern, empty-state pattern, error-message pattern, tooltip rules) lives in DESIGN.md "UX Writing". Cite that section by name when correcting copy.

## Localization

| Rule | Detail | Enforced by |
|---|---|---|
| **All shipped locales reach feature parity at every release** | The initial product ships admin UI in English; source ticket content may be in any language and must be preserved verbatim. | type system + code review |
| **Generated artefacts ship the language declared in the spec** | Default admin language is English. Other locales are opt-in via the spec. | prompt + spec extraction |
| **Numbers and dates locale-driven** | Use `Intl.NumberFormat` and `Intl.DateTimeFormat` with explicit locale and options. Never templated string concatenation. | prompt + lint |
| **Accents and typography correct for each locale** | Proper accents, locale-correct quotation marks, locale-correct spacing rules around punctuation. | prompt + design-review |

If your project ships a single language, replace the table with a single rule stating which language and how strings are managed.

## Anti-Patterns

What no artefact this project produces should resemble. Visual specifics live in DESIGN.md "Absolute Bans"; the rules below are the strategic equivalents.

| Anti-pattern | Why it's banned | Enforced by |
|---|---|---|
| **Greeting theatre + suggestion chips** | Consumer chatbot register; signals the tool is ornamental. | prompt + design-review |
| **Encouragement defaults** | "Great question!", "Excellent!", emoji confetti on save. The product pushes back when warranted; it does not flatter. | prompt + lint |
| **Vendor leak in user copy** | Naming infrastructure providers ("Vercel", "Anthropic API", database brand names) in user-facing copy. See DESIGN.md UX Writing rename table. | prompt + design-review |
| **Visual progress as substance** | Gradients, glass-blur, count-up animations used to mask thin information architecture. If a component does not need them, it does not get them. | prompt + design-review |
| **Lorem ipsum / `John Doe`** | Filler data signals an unfinished hypothesis. If realistic data cannot be invented, ask the user. | prompt |

## Accessibility & Inclusion

Mandatory floor:

| Rule | Detail | Enforced by |
|---|---|---|
| **WCAG 2.1 AA** | Contrast ≥ 4.5:1 for body, 3:1 for large text and UI states. Color-coded states pair with a label or icon. | prompt + design-review |
| **Dark mode parity** | Both modes pass contrast. Tokens invert. No hardcoded colors. | DESIGN.md token system + lint (raw `#[0-9a-f]{3,6}` in JSX) |
| **Reduced-motion fallback** | Every motion cue has a non-motion equivalent (color, icon, label change). `prefers-reduced-motion` honoured. | DESIGN.md motion section + design-review |
| **Plain-language UI** | Technical detail is opt-in via tooltips or pages explicitly marked technical, never the default. | DESIGN.md UX Writing |
| **Form errors recover** | Plain language, end with a next step. Raw API responses in `alert()` are a regression. | prompt + design-review |
