# Devin brief — Round 3a: Frontend

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`,
`DESIGN.md` (in full — this brief implements it), `ROADMAP.md`. Rounds
2a–2e must already be merged to `main` — branch from `main` after that,
so you're integrating against real, working endpoints, not mocks
(including 2e's real `POST /api/demo`, which the "Try the live demo"
button depends on).

## What you own (create/edit only these)

```
public/**
tests/frontend-markdown/**   (new — see item 8 below)
```

Concretely (create this structure): `public/index.html` (landing page,
`DESIGN.md` §7, including the hero visual card per §7's concrete spec),
`public/login.html`, `public/register.html`,
`public/invite.html` (accept-invite page), `public/app/dashboard.html`
(workspace incident list), `public/app/incident.html` (incident detail:
timeline / matrix / evidence / audit tabs), `public/app/settings.html`
(workspace members, invite, API tokens), `public/css/tokens.css`
(every custom property from `DESIGN.md` §1–§5, both themes),
`public/css/components.css` (every component in `DESIGN.md` §6),
`public/js/api.js` (a small `fetch` wrapper — JSON in/out, throws a typed
error the UI can render into the four required states), `public/js/
session.js`, `public/js/incidents.js`, `public/js/entries.js`,
`public/js/matrix.js`, `public/js/evidence.js`, `public/js/search.js`,
`public/js/export.js`, `public/js/audit.js`, `public/js/sse.js`
(`EventSource` wrapper implementing the reconnect-then-backfill pattern in
`SPEC.md` §6, plus the debounced connection-status logic from `DESIGN.md`
§6.12), `public/js/markdown.mjs` (**note the `.mjs` extension** — the
only file in `public/` using it, deliberately, so item 8's test can
`import()` it directly as a real ES module under `node --test` without
needing a browser or a DOM library; browsers load it exactly the same way
via `<script type="module" src="/js/markdown.mjs">`. The client-side
implementation of the Markdown subset in `SPEC.md` §11 — HTML-escape
first, then apply the subset; write its core transform as a pure
string-in/string-out function with no `document`/DOM API calls inside it
at all, so it's testable outside a browser, then have the one caller that
uses it do a single `container.innerHTML = renderToHtml(bodyMd)`
assignment of the already-fully-escaped result — never assign unescaped
input to `innerHTML` anywhere), `public/js/theme.js` (dark/light toggle
per `DESIGN.md` §1), `public/fonts/InterVariable.woff2`,
`public/fonts/JetBrainsMono-Regular.woff2`,
`public/fonts/JetBrainsMono-Medium.woff2` (download the actual OFL-
licensed font files and commit them as binary — do not reference a CDN
URL, the CSP forbids external hosts), `public/icons/severity.svg`,
`public/icons/status.svg` (if needed), `public/icons/empty-states.svg`
(per `DESIGN.md` §6.9's pinned stroke-width/cap/join style), `public/
icons/ui.svg` (copy/download/close/etc icons used across components).

## Do not touch

Anything under `src/`, `ir-logger.py`, `requirements.txt`,
`tests/fixtures/markdown-xss-payloads.js` (Round 2d owns and creates this
— you only `import()` it as a read-only data source from your test in
`tests/frontend-markdown/`, exactly the same way you treat `SPEC.md` as a
read-only reference). If a backend response shape doesn't match `SPEC.md`
§5 exactly, or a needed field is missing, describe the mismatch in your
PR description — do not "fix" it by editing a backend route file.

## What to build

Every page/flow in `SPEC.md` §2 and every component in `DESIGN.md` §6,
specifically:

1. **Landing page** (`DESIGN.md` §7) — hero, "Start free" → register,
   "Try the live demo" → `POST /api/demo` then redirect into
   `/app/incident.html?id=<incidentId>` for the seeded demo incident.
2. **Register / Login** — forms posting to `SPEC.md` §5.2's endpoints,
   plus a "Continue with Google" button. Every form validates client-side
   *and* renders the server's actual error message on `4xx` (never a
   generic "something went wrong" when the API returned a specific
   `error` string).
3. **Dashboard** (`public/app/dashboard.html`) — incident list (`DESIGN.md`
   §6.2), "New incident" modal (`DESIGN.md` §6.11), workspace switcher if
   the user has more than one workspace.
4. **Incident detail** — header (`DESIGN.md` §6.4) with severity/status
   pill editing (owner/analyst only — hide the controls, not just disable
   them, for `viewer`), four tabs:
   - **Timeline**: entry cards (`DESIGN.md` §6.5), an entry composer
     (kind picker, technique picker for `technical` entries — a modal per
     `DESIGN.md` §6.11 with search backed by `GET /api/techniques?q=`),
     live updates via `public/js/sse.js`, the "New" marker behavior from
     `DESIGN.md` §6.5, and the connection-status indicator from `DESIGN.md`
     §6.12 — **build the 2-second debounce exactly as specified, do not
     wire the indicator directly to raw connect/disconnect events**; a
     prior project on this box shipped that shortcut and it flickered
     visibly on every brief connection flap, which is the specific mistake
     §6.12 exists to prevent.
   - **Matrix**: the full ATT&CK coverage grid (`DESIGN.md` §6.7),
     keyboard-operable cells, popover listing tagged entries.
   - **Evidence**: upload control + evidence cards (`DESIGN.md` §6.8),
     custody trail expansion, download button.
   - **Audit** (owner-only — the tab itself is not rendered for
     analyst/viewer): paginated audit log table + a "Verify integrity"
     button calling `.../audit/verify` and showing the result plainly
     ("Chain intact — N events checked" or "Tampering detected at event
     <id>" with `--danger` styling).
   - Export buttons (PDF, Markdown) triggering a direct browser navigation
     to the export URL (so the browser's native download flow handles the
     file, no client-side blob-URL juggling needed).
5. **Settings** — member list + role, invite form (owner-only, shows the
   returned `inviteUrl` in a copyable field per `DESIGN.md` §6.8's copy-
   button pattern — no email is sent, per `SPEC.md` §2.9), API token
   create/list/revoke (owner-only, the raw token shown exactly once with a
   clear "copy this now, you won't see it again" warning).
6. **Every list/detail view** implements all four states from `SPEC.md`
   §8.7 and `DESIGN.md` §6.9's exact empty-state copy per surface.
7. **"New since you last viewed"** (`DESIGN.md` §6.2) — on the dashboard's
   incident list, compare each incident's `last_activity_at` (already in
   the `GET /api/workspaces/:id/incidents` response) against a per-
   incident "last viewed" timestamp stored in `localStorage`, written the
   moment an incident's detail page is opened. No schema change, no new
   endpoint — this is entirely a client-side computation over data the
   API already returns.
8. **`tests/frontend-markdown/markdown.test.js`** — a `node --test` file
   that `import()`s `../../public/js/markdown.mjs` and
   `tests/fixtures/markdown-xss-payloads.js` (created by Round 2d — read
   it, do not edit it) and, for every fixture entry, asserts none of that
   entry's `mustNotContain` strings appear unescaped in
   `markdown.mjs`'s output string. This is the client-side half of the
   XSS acceptance criterion Round 2d's brief already has for the server
   side — same payload list, two independently-written implementations,
   per `SPEC.md` §11's "implemented twice by design" note.

## Fail-closed / security stances relevant to this brief

- Role-gated UI (owner-only tabs/buttons, close/reopen controls) must be
  *absent*, not merely disabled-but-visible, for roles that lack the
  permission — this matches the backend's `403`, and prevents a confusing
  "why is this greyed out" state for a `viewer` who was never going to be
  allowed to do it.
- `public/js/markdown.mjs` must HTML-escape all `body_md` content before
  applying the Markdown subset transforms (`SPEC.md` §11) — this is the
  only thing standing between analyst-authored (potentially attacker-
  influenced, e.g. copy-pasted phishing content) text and stored XSS in
  every browser tab viewing the timeline. No `innerHTML` assignment of
  unescaped user content anywhere in `public/`.
- Never render a fabricated/placeholder incident, entry, or "demo" data on
  a *non-demo* page — every value shown must come from a real API
  response. Loading states show a skeleton/spinner, not fake sample
  content.

## Acceptance criteria (testable)

- Every page listed above renders correctly at both a desktop width
  (≥1280px) and a phone width (375px) with no horizontal scroll on the
  page body (`DESIGN.md` §6.7/`SPEC.md` §8.6 — the matrix's own container
  may scroll horizontally, nothing else may).
- Tabbing through the timeline and the ATT&CK matrix reaches every
  interactive element in a sensible order, with a visible focus ring at
  every stop (`SPEC.md` §8.5) — verified manually and described in the PR
  screenshots/notes (no automated a11y test framework is being introduced
  in this round; a manual keyboard walkthrough is sufficient and must be
  described).
- Opening two browser tabs on the same incident's timeline, adding an
  entry in one, shows it appear in the other within a couple of seconds
  with no manual refresh.
- Killing the server, restarting it, and reloading a tab that was on the
  timeline still shows the full, correct entry list (proving the SSE
  reconnect-then-backfill pattern from `SPEC.md` §6 works, not just the
  live-update path).
- A `viewer` account sees no severity/status edit controls, no entry
  composer, no upload control, and no Audit tab.
- The landing page's "Try the live demo" button, with no prior account,
  lands the visitor inside a working, fully-seeded incident timeline
  within one click.
- Every empty state listed in `DESIGN.md` §6.9 has been triggered and
  screenshotted at least once (e.g. a brand-new workspace's empty
  dashboard, an incident with zero evidence, a search with zero results).
- `npm test` (including the new `tests/frontend-markdown/markdown.test.js`)
  passes — every fixture payload in `tests/fixtures/markdown-xss-
  payloads.js` renders through `markdown.mjs` with none of its
  `mustNotContain` strings appearing unescaped, including the mixed-case
  and leading-whitespace/control-character `javascript:` variants.
- Simulating a sub-2-second connection drop (disconnect then immediately
  reconnect the test `EventSource`, or the harness's equivalent) never
  flips the connection-status indicator out of "Live" — a drop held for
  longer than 2 seconds does. Described and screenshotted (or otherwise
  demonstrated) in the PR, not just asserted.
- A brand-new incident (never opened) shows the "new since last viewed"
  indicator on the dashboard; opening it and returning to the dashboard
  clears it.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output (this round
adds exactly one automated test file, `tests/frontend-markdown/
markdown.test.js` — the rest of this brief has no automated coverage, by
design, per `AGENTS.md` §2's no-build-step/no-browser-test-tooling
constraints), **screenshots required** for every page/state listed in the
acceptance criteria, at both desktop and phone widths, SPEC.md/DESIGN.md
sections implemented, what was left out.

Branch from `main`, open a PR, do not merge.
