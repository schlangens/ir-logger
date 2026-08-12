# DESIGN.md — visual design system

This app must read as a premium, purpose-built security product — closer to
a professional forensics tool than a generic admin dashboard. Every rule in
this document is a requirement, not a suggestion; an agent implementing
`public/` must follow it exactly. All tokens below are CSS custom
properties defined once in `public/css/tokens.css` and consumed everywhere
else — no component file hard-codes a color, size, or shadow value.

---

## 1. Palette

### 1.1 Dark theme (default — `:root`, and `[data-theme="dark"]`)

```css
--bg-canvas: #0b0d12;        /* page background, near-black */
--bg-surface: #12151c;       /* panels, cards */
--bg-surface-raised: #1a1e28;/* nested panels, table row hover, inputs */
--bg-overlay: rgba(6, 7, 10, 0.72); /* modal/toast backdrop */

--border-subtle: #232833;
--border-default: #333a4a;
--border-strong: #4a5468;

--text-primary: #e8eaf0;
--text-secondary: #a2a9bd;
--text-muted: #6b7284;
--text-on-accent: #08101f;

--accent: #4c8dff;
--accent-hover: #6ea1ff;
--accent-active: #3a72e0;
--accent-muted: rgba(76, 141, 255, 0.14);

--severity-low: #3fb950;
--severity-medium: #d4a72c;
--severity-high: #e8833a;
--severity-critical: #e5484d;

--status-open: #4c8dff;
--status-contained: #2fb8a6;
--status-eradicated: #a374e0;
--status-recovered: #3fb950;
--status-closed: #6b7284;

--danger: #e5484d;
--danger-muted: rgba(229, 72, 77, 0.14);
--success: #3fb950;
--warning: #d4a72c;
```

### 1.2 Light theme (`[data-theme="light"]`)

Same variable names, light values — component CSS never branches on theme,
it only ever reads the token:

```css
--bg-canvas: #f4f5f8;
--bg-surface: #ffffff;
--bg-surface-raised: #eef0f4;
--bg-overlay: rgba(20, 23, 30, 0.45);

--border-subtle: #e2e4ea;
--border-default: #cbd0dc;
--border-strong: #9aa1b4;

--text-primary: #14171f;
--text-secondary: #4a5165;
--text-muted: #7a8194;
--text-on-accent: #ffffff;

--accent: #2f6fe0;
--accent-hover: #1f5bcc;
--accent-active: #184aa8;
--accent-muted: rgba(47, 111, 224, 0.10);

--severity-low: #1f8a3b;
--severity-medium: #a3790f;
--severity-high: #c15b18;
--severity-critical: #c92931;

--status-open: #2f6fe0;
--status-contained: #17806f;
--status-eradicated: #7a3fc4;
--status-recovered: #1f8a3b;
--status-closed: #6b7284;

--danger: #c92931;
--danger-muted: rgba(201, 41, 49, 0.10);
--success: #1f8a3b;
--warning: #a3790f;
```

Theme is chosen by `prefers-color-scheme` on first load and overridable by
a top-bar toggle that sets `data-theme` on `<html>` and persists the choice
in `localStorage` (`ir-logger-theme`).

### 1.3 Severity is never color-only

Every severity indicator (badge, matrix legend, incident list row) pairs
its color with **both** a text label (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`, all
caps, always rendered as text — never color/icon alone) and a distinct
icon shape, drawn from a self-hosted SVG sprite at `public/icons/severity.svg`:

- `low` — a single filled circle.
- `medium` — a filled circle with a horizontal dash through the center.
- `high` — a filled upward-pointing triangle.
- `critical` — a filled diamond with a vertical exclamation bar inside it.

No emoji anywhere in the UI (`AGENTS.md`/`SPEC.md` non-goals) — icons are
always this SVG sprite, referenced with `<svg><use href="/icons/severity.svg#icon-low"/></svg>`
and given `aria-hidden="true"` since the adjacent text label already
carries the meaning.

---

## 2. Type

Self-hosted variable sans for UI text, self-hosted monospace for
identifiers, hashes, technique IDs, and code blocks in entries.

- Sans: **Inter Variable** (OFL-licensed), vendored to
  `public/fonts/InterVariable.woff2` (weight range 400–700 in one variable
  file — no separate static weight files needed).
- Mono: **JetBrains Mono** (OFL-licensed), vendored to
  `public/fonts/JetBrainsMono-Regular.woff2` and
  `JetBrainsMono-Medium.woff2`.

```css
--font-sans: 'Inter Variable', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, monospace;

--text-xs: 0.75rem;   /* 12px — timestamps, meta */
--text-sm: 0.875rem;  /* 14px — body, table cells */
--text-base: 1rem;    /* 16px — default body */
--text-lg: 1.25rem;   /* 20px — card/section headings */
--text-xl: 1.5rem;    /* 24px — incident title */
--text-2xl: 2rem;     /* 32px — page/hero headings */

--leading-tight: 1.25;
--leading-normal: 1.5;
```

Hashes, technique IDs (`T1566.001`), and stored evidence filenames are
always rendered in `var(--font-mono)`, `var(--text-sm)`, with a copy-to-
clipboard icon button beside them (see §7 Evidence card) rather than
requiring the analyst to select monospace text by hand.

**Timestamps are always UTC, always labeled.** Every timestamp rendered
anywhere in the app (`occurred_at`, `created_at`, `uploaded_at`, custody
event times, audit log times) displays in UTC — never converted to the
viewer's local timezone — formatted `YYYY-MM-DD HH:mm UTC` in
`var(--font-mono)`, with the literal `UTC` suffix always present, never
implied. This matches standard incident-response practice (a shared
timeline across analysts in different timezones only works if "when" is
unambiguous) and matches what's actually stored (`SPEC.md` §5's ISO 8601
UTC convention) — there is no timezone-conversion logic anywhere in this
app to get wrong.

---

## 3. Spacing + layout

4px base scale:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
--space-8: 64px;
```

Page content max-width `1280px`, centered, with `--space-5` side padding
on desktop and `--space-3` on phone widths (`< 640px`). Panels/cards use
`--space-4` internal padding on desktop, `--space-3` on phone.

---

## 4. Elevation + borders

Exactly two elevation levels — no third, no drop shadow deeper than these:

```css
--elevation-1: none; /* cards/rows: border only */
--elevation-2: 0 8px 24px rgba(0, 0, 0, 0.35); /* modals, toasts, open dropdowns */
```

Every card/panel/row uses a `1px solid var(--border-subtle)` border and
`var(--elevation-1)` (i.e. no shadow) at rest. On hover/focus, the border
changes to `var(--border-default)` — no shadow is added on hover. Only
things that visually float above the page content (modal panel, toast,
open dropdown/popover) use `var(--elevation-2)`. No gradients anywhere as
decoration (a gradient may only appear as a functional heat scale, see §8
matrix cells — never on a button, header, or hero background).

---

## 5. Motion

```css
--motion-fast: 120ms ease;
--motion-base: 180ms ease;
```

Hover/focus transitions use `--motion-fast`; modal/toast enter-exit and
the matrix cell heat-highlight use `--motion-base`. Nothing in the app
animates longer than 200ms. A single global rule:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
```

---

## 6. Component specs

### 6.1 Top bar

Fixed height 56px, `--bg-surface`, bottom border `--border-subtle`. Left:
wordmark ("Incident Logger") + current workspace name in a dropdown
(switches workspace if the user belongs to more than one). Center: global
search input (`⌘K`/`Ctrl+K` focuses it), routes to §5.8's search endpoint.
Right: theme toggle (icon-only button, `aria-label="Toggle color theme"`),
user menu (avatar-less — initials in a circle, `--accent-muted` background,
`--accent` text — opens a dropdown with "Workspace settings", "Sign out").
On phone widths, search collapses to an icon that expands to a full-width
overlay input on tap.

### 6.2 Incident list row

A `<table>` (§8.5 accessibility — real table markup, not divs), one `<tr>`
per incident: ref (mono, `--text-sm`), title (`--text-base`, medium
weight), severity pill (§6.3), status pill (§6.3), entry count, last
activity relative time (`--text-xs`, `--text-muted`). Row hover:
background `--bg-surface-raised`, no shadow. Entire row is a link to the
incident detail page (`<tr>` wraps a single focusable `<a>` covering the
row via a stretched-link pattern, so keyboard/screen-reader users get one
stop per row, not five).

**"New since you last viewed" indicator**: a small filled `--accent` dot
(6px, `aria-hidden="true"`, paired with a visually-hidden `"Updated since
you last viewed"` span for screen readers — dots are never the only
signal) to the left of the title, shown when the incident's
`last_activity_at` (`SPEC.md` §5.4) is more recent than a per-incident
"last viewed" timestamp the browser stores in `localStorage` (keyed by
incident id, written the moment the incident detail page is opened — no
schema change, no server round-trip, purely a client-side comparison).
The dot disappears the next time that incident is opened, since opening
it updates the stored last-viewed time.

### 6.3 Severity + status pills

Pill: `border-radius: 999px`, `padding: 2px 10px`, `--text-xs`, uppercase,
`font-weight: 600`, 1px border in the token color at 100% opacity,
background in the token color at ~14% opacity (reuse the `-muted` pattern
per-token), text in the full-opacity token color. Severity pills always
include the icon from §1.3 to the left of the text at 12px. Status pills
are text-only (status already has five distinct always-visible words, no
icon needed to disambiguate).

### 6.4 Incident header

`--text-2xl` title, ref shown as `--font-mono` `--text-sm` `--text-muted`
directly beneath it, severity + status pills to the right of the title on
desktop (stacked beneath it on phone), summary as a `--text-base`
paragraph below, then a horizontal tab strip: Timeline / Matrix / Evidence
/ Audit (Audit tab only rendered for `owner` role — hidden, not just
disabled, for `analyst`/`viewer`, matching the API's `403` for that
endpoint).

### 6.5 Timeline entry card

Left edge: a 3px vertical bar colored by `kind`
(`technical`→`--accent`, `timeline`→`--status-eradicated`,
`note`→`--text-muted`). Header row: author name, kind badge (small, text
only: "Technical" / "Timeline" / "Note"), `occurred_at` (`--text-sm`,
`--font-mono`), with `created_at` shown in parentheses only when it differs
from `occurred_at` by more than 5 minutes (§SPEC 2.1). Body: rendered via
the Markdown subset (§SPEC 11). Footer (only for `technical` entries with
tags): technique chips (§6.6). New entries arriving live via SSE animate in
with a `--motion-base` fade + 4px slide-down, and are visually marked
"New" (a small `--accent` dot, `aria-live="polite"` announcement of "New
entry from <author>") for 10 seconds, then the marker is removed (the
entry itself stays, permanently, in the list).

### 6.6 Technique tag chip

`border-radius: 6px`, `padding: 2px 8px`, `--bg-surface-raised` background,
`1px solid var(--border-default)`, content = mono ID (`T1566.001`) +
regular-weight name, `--text-xs`. Clicking a chip opens a popover with the
technique's full name, tactic, and a link to `attack.mitre.org` (opens in
new tab, `rel="noopener noreferrer"`).

### 6.7 ATT&CK matrix cell states

The matrix wrapper is the one place `overflow-x: auto` is used on this app
(§SPEC 8.6) — the 14 tactic columns lay out in a CSS grid inside that
wrapper, each column a fixed `160px` minimum width, wrapper itself
`max-width: 100%` inside the page so the page body never scrolls
horizontally.

**Grid convention (this is the part that makes it read as a matrix, not
a pile of ragged chip columns)**: tactic columns have different
technique counts (`SPEC.md` §2.2.1's seed set ranges from 3 to 5
techniques per tactic), but the matrix uses one shared row track across
*all* columns, matching the real MITRE ATT&CK Navigator's convention —
`grid-template-rows: repeat(<N>, minmax(64px, auto))` on the matrix's
outer grid, where `<N>` is the technique count of the *tallest* column
(the tactic with the most seeded techniques). Every column places its
technique cells starting at row 1 of that shared track; a column shorter
than `<N>` does not leave a gap or get taller cells — its remaining row
slots are filled with padded, non-interactive placeholder cells
(`--bg-canvas` background, no border, no content, not a real `<button>`,
`aria-hidden="true"`) so every column is visually the same total height
and cells align into true horizontal rows left-to-right, the way the
Navigator's grid does. Every real cell shares one minimum height —
`min-height: 64px` — regardless of how long its technique name is, so
cells never look jagged against each other.

**Cell internal layout** (top to bottom, inside that shared `64px`
minimum): the technique's mono id (`T1566.001`, `--font-mono`,
`--text-xs`, top-left) with its `count` rendered as a small circular
badge in the cell's top-right corner (`--text-xs`, `--bg-canvas`
background, 1px `--border-default` border — omitted entirely, not shown
as "0", when `count` is 0, since the cell's own recessed fill state
already communicates zero without a redundant badge); below that, the
technique's name, `--text-xs`, `--text-secondary`, truncated to one line
with `text-overflow: ellipsis` (never wrapped — wrapping is what breaks
the shared row height). Cell states (fill color, applied to the whole
cell behind this layout):

- **Unused** (`count: 0`): `--bg-surface`, `--border-subtle` border,
  `--text-muted` text — visibly present but visually recessed.
- **Light** (`count: 1`): `--accent-muted` background, `--border-default`
  border, `--text-primary` text.
- **Medium** (`count: 2–3`): background is `--accent` at 35% opacity
  (a single functional gradient-free opacity step — not a decorative
  gradient), `--text-primary` text, `--border-default` border.
- **Heavy** (`count: 4+`): background `--accent` at 65% opacity,
  `--text-on-accent`-equivalent contrast text (falls back to
  `--text-primary` since accent-on-dark already passes contrast; the
  light theme's equivalent step uses `--text-primary` too, verified
  against the actual computed background at implementation time), bold
  weight.
- **Focused/selected** (keyboard focus or click): `2px solid var(--accent)`
  outline in addition to whatever fill state applies, and opens a popover
  listing every entry in this incident tagged with that technique
  (`aria-expanded` on the cell button, `role="dialog"` popover, Esc
  closes and returns focus to the cell).

Every cell is a real `<button>` (keyboard-operable, §SPEC 8.5), not a
`<div>` with a click handler.

### 6.8 Evidence card

Filename (`--text-base`, medium weight, truncated with `text-overflow:
ellipsis` at 40 chars, full name in `title` attribute), size + upload time
(`--text-xs`, `--text-muted`), SHA-256 shown as `--font-mono` `--text-xs`
in a `--bg-surface-raised` inset chip, truncated to `a1b2c3d4…e5f6a7b8`
(first 8 + last 8 hex chars) with a copy-icon button
(`aria-label="Copy full SHA-256 hash"`) that copies the full 64-char value
and shows a toast confirmation. A "View custody trail" link expands an
inline `<ol>` of custody events (§SPEC 2.3) beneath the card. Download
button is a plain icon+label button ("Download"), never a bare icon.

### 6.9 Empty states

Centered within their container: a single-color line-art icon (from
`public/icons/empty-states.svg`, 48px, `--text-muted`), a `--text-lg`
heading naming what's missing ("No entries yet", "No evidence uploaded",
"No matches"), one `--text-sm` `--text-secondary` sentence of context, and
— where an action exists — a single primary button. Per-surface copy:

**Icon style family** (every icon in `empty-states.svg` shares these
exact parameters so the set reads as one consistent family, not a
scavenged mix): `viewBox="0 0 24 24"`, `stroke-width: 1.5`,
`stroke-linecap: round`, `stroke-linejoin: round`, `fill: none`,
`stroke: currentColor` (inherits `--text-muted` from the icon's
container — never a hard-coded color), displayed at `48px × 48px`. This
is a deliberately calm, outline-only line-icon family, distinct on
purpose from the *filled*, solid-shape severity icons in §1.3 — severity
icons need to read instantly as a solid glyph at a glance in a list;
empty-state icons are illustrative, not signal-bearing, and use the
quieter outline treatment. Do not mix the two styles within either set.

- Timeline, no entries: "No entries yet" / "Log the first finding to start
  this incident's timeline." / button "Add entry".
- Evidence, none uploaded: "No evidence uploaded" / "Upload a file to
  start this incident's chain of custody." / button "Upload evidence".
- Search, no query yet: "Search this workspace" / "Find anything logged
  across every incident's timeline." (no button — the search input itself
  is the action).
- Search, no results: "No matches for “<query>”" / "Try a different term,
  or check another workspace if you belong to more than one." (no button).
- Incident list, no incidents: "No incidents yet" / "Open one to start
  tracking findings, evidence, and timeline." / button "New incident".
- Audit log (owner, workspace with zero events — should not normally
  happen post-Round-1 seed, but the empty state is still designed): "No
  audit events yet" / "Actions in this workspace will appear here as they
  happen." (no button).

### 6.10 Toasts

Bottom-right stack, `--elevation-2`, `--bg-surface`, `1px solid
var(--border-default)`, left 3px accent bar colored by variant
(`--success`/`--danger`/`--warning`/`--accent` for info). Icon + message +
close button. `success`/`info`/`warning` auto-dismiss after 5 seconds;
`error` (`--danger`) stays until manually dismissed, since an error the
analyst didn't get to read is worse than one that lingers. `role="status"`
for success/info, `role="alert"` for error/warning (so screen readers
announce errors immediately, others politely).

### 6.11 Modal pattern

Centered panel, `max-width: 480px` (560px for the technique picker, which
needs more room for search results), `--bg-surface`, `--elevation-2`,
`--bg-overlay` backdrop covering the full viewport. Focus moves to the
modal's first focusable element (or its close button if the first field
needs the user to read context first) on open, and is trapped inside the
modal (`Tab`/`Shift+Tab` cycle within it) until closed. `Escape` closes and
returns focus to the element that opened it. The backdrop is clickable to
close for non-destructive modals (create incident, add entry, technique
picker) but **not** for destructive/consequential ones (closing/reopening
an incident, deleting an API token) — those require an explicit
Cancel/Confirm button click, no backdrop-click or Escape shortcut to
confirm.

### 6.12 Connection status indicator

A small, unobtrusive indicator near the top bar (or inline in the
timeline header) showing the live SSE connection's health: a filled 6px
dot + one word — `--success` "Live" (connected, normal), `--warning`
"Reconnecting…" (connection dropped, `EventSource` auto-retrying),
`--danger` "Offline" only after repeated failed reconnect attempts, not
on the first drop. **This must be debounced — do not wire it directly to
raw connect/disconnect events.** A prior project on this box shipped an
indicator wired straight to connection events and it flickered visibly on
every brief connection flap (a network blip, a server restart, a laptop
sleeping briefly), which read as a broken app even though the underlying
`EventSource` reconnect logic was working correctly. The rule here: the
indicator only transitions *out* of "Live" after the connection has been
down continuously for at least a **2-second grace period** — a
`setTimeout(2000)` armed the instant a disconnect is observed and
cleared immediately if reconnection succeeds before it fires, so a
sub-2-second flap never reaches the UI at all. Transitioning back *to*
"Live" on successful reconnect is immediate (no debounce needed in that
direction — showing "connected" sooner is never confusing). `role="status"`,
`aria-live="polite"` on the label text so screen reader users hear state
changes without them being disruptive.

---

## 7. Landing page (`/`, logged out)

Not gated behind auth. Structure:

- Top bar: wordmark left, "Log in" + "Sign up" links right (no search, no
  user menu — this is the logged-out variant of §6.1).
- Hero (`--space-8` top padding, `--bg-canvas`), laid out as two columns
  on desktop (`≥1024px`: text column ~55% width, visual column ~45%,
  `--space-6` gap, vertically centered) and stacked on smaller widths
  (text first, full-width visual below it, `--space-6` gap) — a text-only
  hero was the flagged risk here (it reads as a generic pre-launch page to
  this audience), so the visual is not optional polish, it's required:
  - Text column: `--text-2xl` (scaled up further, `2.5rem`, for the hero
    only) headline — "Run the incident, don't chase the paperwork." —
    `--text-lg` `--text-secondary` subhead — "A shared incident timeline
    for security teams: live entries, ATT&CK tagging, hashed evidence,
    and a hash-chained audit log you can verify." (see the honest-claim
    note below) — two buttons side by side (stacked on phone): primary
    "Start free" → `/register`, secondary (outlined, not filled —
    visually secondary but still a real button, not a link) "Try the live
    demo" → `POST /api/demo` then redirect into the created workspace's
    incident view.
  - Visual column: a single chrome-less card (`--bg-surface`, `1px solid
    var(--border-subtle)`, `12px` border-radius, `--elevation-2`,
    `--space-4` internal padding) containing a **static, decorative**
    (`aria-hidden="true"` — it duplicates no information a screen reader
    needs; the real CTAs carry the actual actions) miniature mock of the
    product: a one-line header row with a `HIGH` severity pill (§6.3) and
    a title ("Suspicious login → lateral movement"), then exactly 4
    miniature timeline-entry rows below it, each one line: an author
    initial-circle, a short bolded action phrase ("Spearphishing email
    identified", "Macro execution confirmed", "LSASS memory access
    observed", "Host isolated from network"), and — on exactly the 2nd
    and 3rd rows only — one technique chip (§6.6) each (`T1566.001`,
    `T1003.001`) to show tagging without cluttering every row. This
    content is hard-coded directly in `index.html` (not fetched, not
    live) — it is marketing content illustrating the product, and must
    visually match the real timeline entry card (§6.5) and technique
    chip (§6.6) specs exactly, just at a smaller scale, so it reads as a
    genuine product screenshot rather than a mockup that doesn't match
    what the app actually looks like once you're in it.
- Three-feature row directly below the hero, `--space-6` vertical gap, one
  icon + heading + one sentence each, laid out in a 3-column grid on
  desktop that stacks to 1 column under 768px: "Live shared timeline" /
  "Everyone on the response sees every entry the second it's logged.",
  "ATT&CK coverage at a glance" / "Tag findings to MITRE techniques and see
  your coverage gaps in one matrix.", "A record you can verify" / "Entries
  are immutable, and every workspace action is hash-chained into an
  owner-visible audit log."
- Footer: plain text links (Log in, GitHub repo), `--text-xs`,
  `--text-muted`, `--space-6` top padding, top border `--border-subtle`.

**On honest claims** (this matters more than it might seem for this
audience): neither the subhead nor the feature row claims the audit log
is unforgeable or that tampering is impossible — `SPEC.md` §2.7 states
exactly what the hash chain does and does not protect against, and the
marketing copy is not allowed to say more than the spec backs up. "Entries
are immutable, and every workspace action is hash-chained into an
owner-visible audit log" is a fact about what the app does; "you can prove
nothing was quietly edited" (an earlier draft's wording) is a claim about
what an outside party could conclude, which isn't true against a
privileged actor with direct database access — see §2.7's scoped
guarantee. A scoped, defensible claim earns more credibility with a
security-practitioner audience than an inflated one that a five-minute
read of the spec would contradict.

No gradient hero background, no stock photography, no emoji — same rules
as the rest of the app (§4, §1.3). The hero's only visual flourishes are
the accent color on the two CTA buttons, the visual column's card, and a
single thin `--border-subtle` rule separating the hero from the feature
row.
