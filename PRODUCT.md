# Product Foundation

Strategic constitution applied to every artefact this project produces. Sits with DESIGN.md (visual + UX writing), SECURITY.md (data policy), CONTRIBUTING.md (engineering), CLAUDE.md (AI behaviour), ARCHITECTURE.md (patterns). Each rule below ends with `Enforced by:` so a future agent can audit drift.

> **Note on enforcement reality (2026-05-06).** TypeScript, Drizzle schema design, Vitest, Playwright scenario drift checks, and code review are real today. Lint sweeps and design-review automation are aspirational until wired into CI.

## Register

Register: `internal-tool`.

This project produces a support control tower for operators who need one place to see open feedback tickets coming from several applications. It is a repository of links and mirrored statuses, not the operational dashboard where ticket work happens. It is not a customer-facing helpdesk, a marketing site, or a public issue tracker.

## Users

Default users are product/support operators and builder-admins who know the applications being monitored. They work mostly on desktop, scan queues repeatedly, and need source-app context more than decorative presentation.

Secondary users are source-app maintainers who need a clear ingest contract to connect their app feedback loops. Any external reporter-facing surface is a separate product decision.

## Job to Be Done

Primary job: collect open bug and evolution tickets from feedback loops across applications, normalize them, and let an operator jump to the original app dashboard where the work happens.

Success is observable when a source app can POST a ticket to `/api/feedback/ingest`, the ticket is upserted without duplication, the dashboard shows it in the open queue under the correct application, and the ticket title links to the original feedback dashboard in the source app.

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
