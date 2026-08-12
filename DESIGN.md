# Support Control Tower Design System

This file is the visual and UX-writing contract for every operator and
administrator surface. PRODUCT.md defines the product strategy; this file
defines how that strategy looks, reads, and behaves.

## Product Context

- **What this is:** an internal support control tower that normalizes open
  feedback from multiple applications and links operators back to the source.
- **Who it is for:** support and product operators scanning dense queues, plus
  builder-admins maintaining applications, teams, access, and delivery policy.
- **Physical scene:** operators scan queues repeatedly on 27-inch office
  monitors in mixed daylight; on-call operators sometimes use the same product
  in dim rooms.
- **Project type:** responsive authenticated web application.
- **Register:** product. Familiar controls and scan speed take priority over
  novelty.

## Aesthetic Direction

- **Direction:** quiet operational ledger. Cool tinted paper surfaces, precise
  rules, compact labels, and one mineral-blue accent keep attention on state and
  ownership.
- **Theme decision:** light-first because the dominant physical scene is a
  daylight office. Dark and system modes are complete peers for dim on-call use.
- **Color strategy:** restrained. Chromatic color stays below 10 percent of the
  normal interface and communicates action, selection, or semantic state only.
- **Approved mockup:** none. This document and the shipped components are the
  canonical reference.

## Absolute Bans

- No greeting theatre, suggestion-chip menus, encouragement defaults, emoji,
  or exclamation marks as default punctuation.
- No gradient text, decorative body gradients, decorative blur, glass cards,
  hero-metric templates, or repeated identical icon-card grids.
- No colored side-stripe borders on cards, list items, notices, or alerts.
- No nested cards. Use headings, dividers, tables, and whitespace to express
  hierarchy inside a surface.
- No decorative bounce, count-up, parallax, or orchestrated page-load motion.
- No display fonts in labels, buttons, tables, or data.
- No invented controls, custom scrollbars, or modal-first workflows where an
  inline or progressive path works.
- No raw infrastructure errors, vendor names, filler copy, Lorem ipsum, or
  fictional people named John Doe.
- No hardcoded color values in JSX. Semantic states always pair color with
  visible text or an accessible label.

## Typography

- **UI family:** `Inter`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`,
  `system-ui`, sans-serif. Weights 400, 500, 600, and 700 only.
- **Data and tables:** the UI family with `font-variant-numeric: tabular-nums`.
- **Code:** `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`, monospace.
- **Tracking:** normal for body and headings; `0.04em` only for uppercase
  micro-labels. Uppercase never carries sentences.
- **Scale:**
  - `--text-xs`: `0.75rem` / 12px, timestamps and micro-labels.
  - `--text-sm`: `0.875rem` / 14px, table cells, badges, secondary copy.
  - `--text-base`: `1rem` / 16px, body copy and controls.
  - `--text-lg`: `1.25rem` / 20px, section headings.
  - `--text-xl`: `1.5625rem` / 25px, page titles.
  - `--text-2xl`: `2rem` / 32px, rare overview heading only.
- **Line heights:** body `1.5`, table/UI `1.35`, headings `1.2`, tight `1.1`.
- **Line length:** explanatory prose is capped at `72ch`; dense tables may run
  wider inside a keyboard-scrollable region.

## Color

All values are OKLCH. Near-white and near-black neutrals carry a slight blue
tint; pure white and pure black are not used.

### Light tokens

| Token | Value | Usage |
|---|---|---|
| `--background` | `oklch(0.975 0.006 248)` | App canvas |
| `--foreground` | `oklch(0.235 0.018 248)` | Primary text |
| `--muted` | `oklch(0.48 0.025 248)` | Secondary text |
| `--surface` | `oklch(0.995 0.004 248)` | Primary work surface |
| `--surface-subtle` | `oklch(0.95 0.01 248)` | Sidebar, alt rows, quiet controls |
| `--surface-raised` | `oklch(0.985 0.006 248)` | Menus and sticky controls |
| `--border` | `oklch(0.58 0.025 248)` | Rules and control borders, ≥3:1 on adjacent surfaces |
| `--border-strong` | `oklch(0.54 0.035 248)` | Selected and active boundaries, ≥3:1 |
| `--accent` | `oklch(0.48 0.13 252)` | Primary action and current selection |
| `--accent-hover` | `oklch(0.42 0.13 252)` | Primary hover |
| `--accent-active` | `oklch(0.37 0.12 252)` | Primary pressed state |
| `--accent-foreground` | `oklch(0.98 0.006 248)` | Text on accent |
| `--focus` | `oklch(0.58 0.13 252)` | Focus ring, ≥3:1 on adjacent surfaces |
| `--success` | `oklch(0.43 0.12 155)` | Confirmed positive state |
| `--success-subtle` | `oklch(0.94 0.04 155)` | Success background |
| `--warning` | `oklch(0.48 0.12 72)` | Retry, degraded, needs review |
| `--warning-subtle` | `oklch(0.95 0.045 82)` | Warning background |
| `--danger` | `oklch(0.48 0.17 28)` | Failure and destructive action |
| `--danger-subtle` | `oklch(0.95 0.035 28)` | Failure background |
| `--info` | `oklch(0.46 0.12 235)` | Informational state |
| `--info-subtle` | `oklch(0.95 0.035 235)` | Informational background |
| `--shadow-color` | `oklch(0.28 0.02 248 / 0.12)` | Raised surface shadow |

### Dark tokens

| Token | Value | Usage |
|---|---|---|
| `--background` | `oklch(0.17 0.012 248)` | App canvas |
| `--foreground` | `oklch(0.92 0.012 248)` | Primary text |
| `--muted` | `oklch(0.70 0.022 248)` | Secondary text |
| `--surface` | `oklch(0.21 0.014 248)` | Primary work surface |
| `--surface-subtle` | `oklch(0.255 0.018 248)` | Sidebar, alt rows, quiet controls |
| `--surface-raised` | `oklch(0.285 0.02 248)` | Menus and sticky controls |
| `--border` | `oklch(0.55 0.035 248)` | Rules and control borders, ≥3:1 on adjacent surfaces |
| `--border-strong` | `oklch(0.61 0.04 248)` | Selected and active boundaries, ≥3:1 |
| `--accent` | `oklch(0.72 0.12 252)` | Primary action and current selection |
| `--accent-hover` | `oklch(0.78 0.11 252)` | Primary hover |
| `--accent-active` | `oklch(0.66 0.12 252)` | Primary pressed state |
| `--accent-foreground` | `oklch(0.17 0.012 248)` | Text on accent |
| `--focus` | `oklch(0.65 0.13 252)` | Focus ring, ≥3:1 on adjacent surfaces |
| `--success` | `oklch(0.72 0.12 155)` | Confirmed positive state |
| `--success-subtle` | `oklch(0.28 0.055 155)` | Success background |
| `--warning` | `oklch(0.78 0.12 82)` | Retry, degraded, needs review |
| `--warning-subtle` | `oklch(0.29 0.055 72)` | Warning background |
| `--danger` | `oklch(0.72 0.15 28)` | Failure and destructive action |
| `--danger-subtle` | `oklch(0.29 0.065 28)` | Failure background |
| `--info` | `oklch(0.74 0.11 235)` | Informational state |
| `--info-subtle` | `oklch(0.29 0.055 235)` | Informational background |
| `--shadow-color` | `oklch(0.08 0.01 248 / 0.45)` | Raised surface shadow |

### Theme behavior

The three choices are `light`, `dark`, and `system`. The choice persists in a
same-site `support-theme` cookie. `app/layout.tsx` reads it on the server. An
explicit choice sets `data-theme="light"` or `data-theme="dark"` on `<html>`
before paint. System leaves the attribute absent and CSS follows
`prefers-color-scheme`, so no client correction or theme flash is required.

## Spacing

- **Base unit:** 4px.
- **Density:** compact-comfortable. Queue rows remain scannable without wasting
  a 27-inch display.
- **Scale:** `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`,
  `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`,
  `--space-8: 32px`, `--space-10: 40px`, `--space-12: 48px`,
  `--space-16: 64px`.
- **Defaults:** sidebar `20px`, page gutter `32px`, surface padding `20px`,
  table cells `10px 12px`, control gap `8px`, section gap `24px`.

## Layout

- **Approach:** grid-disciplined and task-first.
- **Desktop:** fixed `240px` sidebar and flexible work area. Content uses the
  full available width up to `1600px`; prose inside it remains capped at `72ch`.
- **Breakpoints:** `1200px` wide-to-standard density, `960px` sidebar-to-top-nav,
  `720px` table horizontal-scroll threshold, `640px` compact page gutters.
- **Responsive tables:** remain semantic tables inside labelled, focusable,
  horizontal-scroll regions. Cells carry their header as `data-label`; content
  is never silently removed.
- **Radii:** `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`,
  `--radius-xl: 12px`, `--radius-full: 9999px`.
- **Elevation:** borders establish hierarchy. Shadow is reserved for truly
  raised menus or sticky controls, never every panel.

## Motion

- **Approach:** minimal and functional.
- **Durations:** `--motion-micro: 90ms` for hover/focus,
  `--motion-short: 160ms` for button/toggle state, and
  `--motion-medium: 220ms` for navigation or panel disclosure.
- **Easing:** enter `cubic-bezier(0.16, 1, 0.3, 1)`, exit
  `cubic-bezier(0.7, 0, 0.84, 0)`, move `cubic-bezier(0.65, 0, 0.35, 1)`.
- **Allowed motion:** color, opacity, and transform transitions that clarify
  hover, focus, active, or disclosure state. Layout properties do not animate.
- **Reduced motion:** `prefers-reduced-motion: reduce` sets animation and
  transition duration to `0.01ms`. Color, border, text, and ARIA state still
  communicate the change.

## Component Patterns

### App shell and navigation

- The shell is server-rendered. Only pathname-aware links and theme controls
  are client components.
- Navigation order is Escalations, Applications, Deliveries, Teams, Access.
  Support users do not receive Teams or Access destinations.
- Current navigation uses accent-tinted background, visible text, and
  `aria-current="page"`. Keyboard focus always uses the shared focus ring.
- At `960px`, navigation becomes a horizontal top region. It may scroll at
  narrow widths and remains keyboard reachable. Route changes center the active
  destination with reduced-motion-aware scrolling. When measured content
  overflows, explicit 44px previous and next controls make that condition
  visible without a decorative edge fade; each direction is natively disabled
  at its boundary. Both controls disappear and the navigation reclaims their
  columns when the measured content fits.

### Buttons

- Height is at least `40px`; mobile targets reach `44px`.
- Primary uses accent fill and accent foreground. Secondary uses surface fill
  and border. Ghost uses no border until hover. Danger uses danger fill.
- Hover changes fill; active translates by one pixel; focus uses a 2px ring and
  2px offset. Disabled uses muted foreground and no pointer. Loading preserves
  the visible label, disables activation, and sets `aria-busy="true"`.

### Inputs

- Default uses surface fill and border. Hover strengthens the border. Focus
  uses the shared 2px ring. Error pairs danger border with visible recovery
  copy. Disabled uses subtle surface and muted text.
- Labels are always visible. Placeholder text never replaces a label.
- Invalid controls set `aria-invalid="true"`, reference a visible `FieldError`
  with `aria-describedby`, and use a danger border and danger focus ring.

### Badges

- Compact label with `--radius-full`, visible text, and semantic foreground plus
  subtle background. Color is never the only state cue.
- Tones are neutral, success, warning, danger, and info.

### Inline notices

- Full 1px border and subtle semantic fill, never a colored side stripe.
- A short factual title precedes recovery copy. Danger and urgent warning use
  `role="alert"`; info and success use `role="status"`.

### Empty states

- No decorative illustration is required. A heading states what is absent;
  one sentence states why it is absent and what event creates an entry.
- At most one primary action appears. Empty states sit in the owning surface,
  not inside another card.

### Data tables

- Headers use muted 12px uppercase labels and a bottom rule. Cells use 14px
  type, tabular numerals, and `10px 12px` padding. Hover uses subtle surface.
- Loading uses stable skeleton rows or factual status copy. Empty content uses
  the canonical teaching empty state.
- The wrapper is a labelled focusable region for keyboard horizontal scrolling.
  The table keeps a caption for assistive technology.

### Pagination

- Uses a labelled navigation landmark. Previous and next are factual labels;
  page links announce `Page N`, and the active page uses `aria-current="page"`.
- Unavailable steps remain visible with `aria-disabled="true"` and no link.
  Focus and active states match buttons.
- Large result sets render a bounded window containing first, last, current,
  and current neighbors with non-interactive ellipses. DOM size does not grow
  with the page count.

### Surfaces

- A surface earns a border when it groups one task. Interior hierarchy uses
  headings and dividers, not nested panels. Surface padding is 20px desktop and
  16px small-screen.

## UX Writing

### Rename table

| Engineer language | User language |
|---|---|
| source app | application |
| outbox row | delivery |
| routing policy | notification policy |
| provider | channel |
| payload | escalation details |
| credential JWK | application key |
| cron recovery | scheduled recovery |
| database unavailable | data is temporarily unavailable |

### Operational rules

- Buttons are verb plus noun: `Save policy`, `Retry delivery`, `Invite member`.
- Confirmations state facts: `Policy saved`, `3 deliveries queued`.
- Errors state what failed and end with a next step: `Delivery could not be
  queued. Check the channel and retry.` Raw errors never appear.
- Empty states answer why the list is empty and what creates an entry:
  `No deliveries yet. Deliveries appear after an escalation matches an active
  notification policy.`
- Tooltips clarify visible information; they never contain the only label,
  state, or action path.
- Dates and numbers use `Intl` with explicit locale and options. Source ticket
  content is preserved verbatim.
- Copy uses periods and colons. Em dashes are not used.

## Known Drift

| Drift | Where | Reason | Owner | Target |
|---|---|---|---|---|
| Legacy metric cards and chart CSS | Existing dashboard and activity pages | Migration belongs to later page tasks | Support portal overhaul | Task 18 onward |
| Legacy connector copy exposes implementation terms | Existing applications page | Page information architecture is not Task 17 scope | Support portal overhaul | Applications page task |

## Decisions Log

### 2026-08-12: Restrained light-first operational system

- **Decision:** use cool tinted neutrals, one mineral-blue accent, fixed dense
  typography, 4px rhythm, and equal light, dark, and system behavior.
- **Rationale:** repeated daylight queue scanning benefits from high-legibility
  light surfaces; dim on-call work requires complete dark parity. Restrained
  color keeps semantic exceptions visible.
- **Alternatives:** dark-first was rejected because it conflicts with the main
  ambient-light scene. A warmer paper palette was rejected because it reduced
  distinction between warning states and normal surfaces.
