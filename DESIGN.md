# Design System

Sits with PRODUCT.md (strategy), ARCHITECTURE.md (patterns), SECURITY.md (data policy), CONTRIBUTING.md (engineering), CLAUDE.md (AI behaviour). Every visual or UX-writing decision lives here; PRODUCT.md cross-references this file by name.

## Product Context

- **What this is:** one-line description of the product.
- **Who it's for:** primary audience.
- **Space/industry:** the domain context.
- **Project type:** web app / mobile / CLI / native / etc.

## Aesthetic Direction

- **Direction:** state the aesthetic in one phrase. ("Industrial / utilitarian — typography and brand color do the work; decoration is the exception, not the default." / "Editorial / generous — the layout breathes." / etc.)
- **Approved mockup:** path to the canonical mockup file, if one exists.

## Absolute Bans

This project's UI and every generated artefact must refuse these patterns. PRODUCT.md cross-references this section by name. Edit or extend this list per project — but the items below are universal defaults for internal tools and dashboards, and removing one should require a reason logged in the Decisions Log.

- **Greeting theatre.** "Welcome back, {name}!", "Hi! How can I help today?". App shells carry identity in the header; the body carries work.
- **Suggestion-chip menus.** Pre-canned "Try asking..." pills. Forces a register most products do not occupy.
- **Encouragement defaults.** "Great question!", "Excellent!", "Perfect!". Confirmations state facts; they do not flatter.
- **Emoji.** Anywhere in shipped UI. Lucide-style line icons (or inline SVG equivalents) only.
- **Gradient text** (`background-clip: text` over a gradient). Decorative, never meaningful. Emphasis through weight or size.
- **Decorative gradients on body surfaces.** Hero gradient bands, gradient KPI cards, gradient progress backgrounds used as ornament. Gradients are reserved for the canonical brand surfaces documented below; not a default for every page.
- **Glassmorphism as default.** Decorative blurs and translucent cards. Use only when the surface genuinely floats above content (modal backdrop, sticky header over scrolling list); never as ornament.
- **Hero-metric template.** Big number, small label, supporting stats, gradient accent, repeated four times across a page. SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text, repeated endlessly. Vary card shape to match content rhythm.
- **Decorative bouncing / count-up / parallax.** Motion serves comprehension or it does not appear.
- **Vendor names in user copy.** "Vercel", "Anthropic API", database brand names. See "UX Writing" rename table.
- **Raw infrastructure errors.** `alert("Save failed: ECONNRESET")` and friends. See "UX Writing" error rules.
- **Lorem ipsum / `John Doe`.** Mock data is realistic and locale-correct, or the AI asks for a sample.

## Typography

- **Display/Hero:** font family, weights.
- **Body:** font family, weight.
- **UI/Labels:** font family, weight, tracking convention for micro-labels.
- **Data/Tables:** font family with `tabular-nums` enabled.
- **Code:** monospace family.
- **Scale:**
  - `--text-xs`: <px> / <rem> (micro labels, timestamps)
  - `--text-sm`: <px> / <rem> (secondary text, badges)
  - `--text-base`: <px> / <rem> (body text)
  - `--text-lg`: <px> / <rem> (section headings)
  - `--text-xl`: <px> / <rem> (page titles)
  - `--text-2xl`: <px> / <rem> (hero headings, rare)
- **Line heights:** body `<value>`, headings `<value>`, tight `<value>`.

## Color

- **Approach:** state the discipline in one phrase. ("Restrained — two chromatic colors in normal UI; color is rare and meaningful.")

### Brand

| Token | Value | Usage |
|---|---|---|
| `--brand-primary` | `#......` | Primary brand color |
| `--brand-primary-dark` | `#......` | Hover on primary |
| `--brand-primary-light` | `#......` | Active states, focus rings |
| `--brand-primary-50` | `#......` | Subtle backgrounds, info banners |
| `--brand-accent` | `#......` | CTAs, primary callouts |
| `--brand-accent-dark` | `#......` | Hover on accent |
| `--brand-accent-50` | `#......` | Accent backgrounds |

### Neutrals

| Token | Value | Usage |
|---|---|---|
| `--neutral-50` | `#......` | Page background |
| `--neutral-100` | `#......` | Card backgrounds, alt rows |
| `--neutral-200` | `#......` | Borders, dividers, input borders |
| `--neutral-300` | `#......` | Disabled states |
| `--neutral-400` | `#......` | Placeholder text |
| `--neutral-500` | `#......` | Muted text, labels, timestamps |
| `--neutral-600` | `#......` | Secondary body text |
| `--neutral-700` | `#......` | Primary body text |
| `--neutral-800` | `#......` | Headings |
| `--neutral-900` | `#......` | High-contrast text (rare) |

### Semantic

| Token | Value | Usage |
|---|---|---|
| `--semantic-success` | `#......` | Positive states |
| `--semantic-warning` | `#......` | Uncertain states, needs review |
| `--semantic-error` | `#......` | Errors, destructive actions |
| `--semantic-info` | `#......` | Informational messages |

- **Dark mode:** how the toggle works, where the class is applied (`<html>`?), how tokens invert, where the choice is persisted.

## Spacing

- **Base unit:** `<px>` (typically 4px).
- **Density:** comfortable / compact / spacious — pick one.
- **Scale:** `2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)` — adjust as needed.
- Per-surface defaults: chat gap, side-panel padding, header padding, card padding, item gap.

## Layout

- **Approach:** grid-disciplined / freeform / asymmetric — pick one.
- **Grid:** describe the dominant layout (single-column, split-panel, multi-column).
- **Max content width:** `<vw or px>`, with rules for when it shrinks.
- **Border radius:**
  - `--radius-sm`: `<px>` (badges, small)
  - `--radius-md`: `<px>` (buttons, inputs, cards)
  - `--radius-lg`: `<px>` (panels)
  - `--radius-xl`: `<px>` (modal/dialog)
  - `--radius-full`: `9999px` (avatars, pills)

## Motion

- **Approach:** minimal-functional / expressive / minimal-only — pick one.
- **Easing:** enter `<ease-out>`, exit `<ease-in>`, move `<ease-in-out>`.
- **Duration:**
  - micro: 50–100ms (hover, focus rings)
  - short: 150ms (button press, toggle)
  - medium: 200ms (panel open/close)
  - long: 300ms (page transitions, rare)
- **Allowed exceptions to "no decorative motion":** list any (e.g., typing-dots indicator on streaming AI content).
- **`prefers-reduced-motion`:** every motion cue must have a non-motion equivalent (color, icon, label change). When the media query matches, motion is skipped, but the state change still happens.

## Component Patterns

For each canonical component, document the spec: visual treatment, states (default, hover, active, disabled), and rules. Include at least:

### Buttons

- **Primary CTA:** background, text color, radius.
- **Secondary:** outline / filled / ghost.
- **Ghost / tertiary:** convention.

### Inputs

- States: default, focused, error, disabled. Border / background / focus ring rules.

### Cards

- Background, border, radius, padding, hover treatment.

### Toasts and inline confirmations

- Position, duration, success / warning / error treatments.

### Empty states

- Illustration / icon convention, headline, sub-copy that answers "why empty / what triggers an entry".

### Tables

- Header row treatment, body row hover, responsive collapse rule.

(Add or remove components to match what the project actually uses.)

## UX Writing

### Rename table — engineer language → user language

Vendor and infrastructure names never appear in user-facing copy. Maintain a small rename table mapping internal terms to the user-facing equivalent:

| Engineer language | User language |
|---|---|
| `<vendor>` | `<feature name in user copy>` |
| `<technical term>` | `<plain-language equivalent>` |

### Confirmation pattern

State the fact, not the encouragement. "3 rows added" / "Status updated". Never "Bravo!", "Great job!", "Excellent!". Exclamation marks appear only in confirmed-success states, never as default punctuation.

### Error message pattern

Plain language, end with a recoverable next step. "Save failed — your draft is preserved. Retry?" — not `alert("ECONNRESET")`.

### Empty state pattern

Two questions answered: why empty + what triggers an entry. "No invoices yet — invoices appear here once you've added a customer and recorded a sale."

### Tooltip rules

Tooltips clarify, never contain the only path to information. If something matters, it's visible.

## Known Drift

Track legacy patterns that violate the rules above and have not yet been migrated. Each entry: pattern, where it appears, why it hasn't been fixed, owner, target date.

| Drift | Where | Reason | Owner | Target |
|---|---|---|---|---|
| (none yet) | | | | |

## Decisions Log

Append-only. Each entry: date, decision, rationale, alternatives considered.

### YYYY-MM-DD — `<Decision title>`
- **Decision:** ...
- **Rationale:** ...
- **Alternatives:** ...
