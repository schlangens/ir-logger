# Devin brief — Round 3a: Frontend

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`
(in full —§5's "Response field naming — Decision" subsection and its
violation-inventory table are load-bearing for this brief), `DESIGN.md`
(in full — this brief implements it), `ROADMAP.md`.

**Merge order — read this before branching.** Rounds 2a–2e are merged to
`main` and the API is live (166 Node tests + 9 Python tests, green in CI).
A separate, small backend PR normalizing every response field name to the
`snake_case` convention `SPEC.md` §5 now specifies (see that section's
violation-inventory table) is expected to land on `main` **before** this
round starts. Confirm that PR is merged before you branch — every request/
response shape in this brief is written against the *normalized*
(`snake_case`-everywhere) API, not today's mixed one. If you branch before
that normalization PR lands, you are integrating against the wrong shapes;
stop and say so rather than building against camelCase fields this brief
does not use anywhere.

## What you own (create/edit only these)

```
public/**
tests/frontend-markdown/**   (new — see item 9 below)
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
error the UI can render into the four required states, and specifically
distinguishes a `429` response — reading its `Retry-After` header — from
every other error status so callers can show a "try again in N seconds"
message instead of a generic failure, see item 5 below),
`public/js/session.js`, `public/js/incidents.js`, `public/js/entries.js`,
`public/js/matrix.js`, `public/js/evidence.js`, `public/js/search.js`,
`public/js/export.js`, `public/js/audit.js`, `public/js/sse.js`
(`EventSource` wrapper implementing the reconnect-then-backfill pattern in
`SPEC.md` §6, plus the debounced connection-status logic from `DESIGN.md`
§6.12), `public/js/markdown.mjs` (**note the `.mjs` extension** — the
only file in `public/` using it, deliberately, so item 9's test can
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
read-only reference). If a live backend response shape doesn't match this
brief/`SPEC.md` §5 exactly, or a needed field is missing, describe the
mismatch in your PR description — do not "fix" it by editing a backend
route file.

## The real API surface (verified against `src/routes/*.js` and
`src/services/*.js` as merged — build against this, not the endpoint
list from an earlier draft of this brief)

All paths below are mounted under `/api`. Every field name shown is the
**target `snake_case` shape** per `SPEC.md` §5's naming decision — assume
the normalization PR above has already landed. Every error body is
`{ "error": "<message>" }`. `401` = no session at all; `403` = session
exists but the role/account type doesn't permit this action; `404` = not
found *or* belongs to a workspace you're not a member of (§SPEC 5,
"cross-tenant existence rule" — see item 3 below, this is the single most
important status-code rule to get right in the UI); `429` = rate-limited,
`Retry-After` header present (seconds); `503` = a fail-closed guard
(rate limiter or demo-capacity check) could not evaluate — treat identically
to a `429` in the UI (a transient "try again shortly" state), except there
is no `Retry-After` header to read for `503`.

**Auth / session**
- `POST /api/auth/register` `{ email, password, name }` → `201 { user: {id,email,name} }`, session cookie set. `400` on bad input or duplicate email. Rate-limited 5/hour/IP.
- `POST /api/auth/login` `{ email, password }` → `200 { user }`. `401` on bad credentials. Rate-limited 10 failed/15min/IP.
- `POST /api/auth/logout` → `200 { success: true }`.
- `GET /api/auth/google` / `GET /api/auth/google/callback` → OAuth redirect flow; `503 { error }` if Google isn't configured on this deployment.
- `GET /api/auth/session` → **always `200`, never errors**: `{ user: {id,email,name} | null, workspaces: [{id,name,role}] }`. This is your "am I logged in" check on every page load. **Important**: this returns `user: null` for an anonymous demo visitor too (a demo grant is a session flag, not a real account) — see item 6 below for how to detect demo mode instead.

**Workspaces**
- `POST /api/demo` (no auth required, but same-origin enforced — see item 2) → `201 { workspace_id, incident_id }` on first call, or `200` with the **same** `{ workspace_id, incident_id }` if the caller already holds a live demo grant (repeat clicks of "Try the live demo" never create a second workspace). `403 { error: "Invalid origin" }` if the request isn't same-origin (this only matters for direct API calls in dev tooling — a normal same-page `fetch('/api/demo')` call is always same-origin and unaffected). `429`/`503` per the rate-limit/capacity rules above.
- `POST /api/workspaces` `{ name }` (real account only) → `201 { workspace: {id,name,role} }`.
- `GET /api/workspaces` (real account only) → `200 { workspaces: [{id,name,role}] }`.
- `GET /api/workspaces/:id` (session — member or demo grant) → `200 { workspace: {id,name,is_demo,expires_at,created_at,role}, members: [{user_id,email,name,role}] }`. **`workspace.is_demo` is how you detect demo mode** — see item 6.
- `POST /api/workspaces/:id/invite` `{ email, role }` (real account, owner only) → `201 { invite_url }`.
- `POST /api/invites/:token/accept` (real account) → `200 { workspace: {id,name,role} }`, or `404` if the invite is unknown/expired/already accepted.
- `POST /api/workspaces/:id/tokens` `{ name }` (real account, owner only) → `201 { token, token_id }` — `token` is the raw bearer value, shown exactly once.
- `GET /api/workspaces/:id/tokens` (real account, owner only) → `200 { tokens: [{id,name,created_at,last_used_at}] }`.
- `DELETE /api/workspaces/:id/tokens/:tokenId` (real account, owner only) → `200 { success: true }`, or `404`.

**Incidents**
- `POST /api/workspaces/:id/incidents` `{ title, summary?, severity }` (real account, owner/analyst only — see item 6, demo cannot use this) → `201 { incident }`. `409` if the workspace is a demo workspace already at its 5-incident cap.
- `GET /api/workspaces/:id/incidents` (session — member or demo) query `status?, severity?, limit?(default 50,max 200), offset?(default 0)` → `200 { incidents: [...], total }`. Each incident object: `{ id, workspace_id, ref, title, summary, severity, status, opened_at, closed_at, created_by, entry_count, last_activity_at }`.
- `GET /api/incidents/:id` (session — member or demo) → `200 { incident }`, same shape.
- `PATCH /api/incidents/:id` (real account, owner/analyst only — see item 6) any of `{ title, summary, severity, status }` → `200 { incident }`. Moving `status` to/from `closed` requires `owner`; `analyst` gets `403`. `400` on invalid enum values.
- `GET /api/incidents/:id/stream` — SSE, see item 4.

**Entries**
- `POST /api/incidents/:id/entries` `{ kind, occurred_at?, body_md, technique_ids?: [] }` (real account, owner/analyst only — see item 6) → `201 { entry }`. `occurred_at` defaults to now. `kind` must be `technical`/`timeline`/`note`; `technique_ids` only meaningful for `technical` (silently ignored otherwise) and validated server-side (`400` on an unknown id).
- `GET /api/incidents/:id/entries` (session — member or demo) query `since?, kind?, limit?(default 100,max 500)` → `200 { entries: [...] }`. Each entry: `{ id, incident_id, kind, occurred_at, body_md, author_user_id, author_name, created_at, technique_ids: [] }`. `since` is an entry id — used for SSE-reconnect backfill (item 4).
- `GET /api/entries/:id` (session — member or demo) → `200 { entry }`, same shape.

**Techniques + matrix**
- `GET /api/techniques` (session — member or demo) query `tactic?, q?` → `200 { techniques: [{id,name,tactic,url}] }`. Rate-limited 60/min.
- `GET /api/incidents/:id/matrix` (session — member or demo) → `200 { tactics: [{ tactic, techniques: [{id,name,url,count}] }] }`, in the fixed 14-tactic order from `SPEC.md` §2.2.1. Rate-limited 60/min.

**Evidence + custody**
- `POST /api/incidents/:id/evidence` `multipart/form-data`, field `file`, optional field `entry_id` — session (member or demo — **demo visitors can upload**, see item 6) → `201 { evidence }`. `evidence`: `{ id, incident_id, entry_id, filename, mime, size, sha256, uploaded_by, uploaded_at }` (`stored_path` is never returned). Caps: 25MB/file (5MB for a demo workspace), 200MB total/workspace (20MB demo), 5 rows total for a demo workspace. `413` on a file-size violation, `409` on a count/total-cap violation, both checked before any bytes are written. Rate-limited 30/hour.
- `GET /api/incidents/:id/evidence` (session — member or demo) → `200 { evidence: [...] }`, same shape, no `stored_path`.
- `GET /api/evidence/:id` (session — member or demo) → `200 { evidence }`. Logs a view in the custody trail as a side effect.
- `GET /api/evidence/:id/download` (session — member or demo) → `200`, binary stream, always `Content-Type: application/octet-stream` and `Content-Disposition: attachment; filename="<sanitized name>"` regardless of the file's real type — see item 8, use a plain navigation/link for this, not `fetch`+blob. Logs a download in the custody trail.
- `GET /api/evidence/:id/custody` (session — member or demo) → `200 { events: [...] }`, oldest first. Each event: `{ id, evidence_id, action, actor_user_id, at, note }`, `action` one of `uploaded`/`viewed`/`downloaded`.

**Search**
- `GET /api/workspaces/:id/search` (session — member or demo) query `q` (required) → `200 { results: [...] }`, max 50, ranked by relevance. Each result: `{ incident_id, incident_ref, incident_title, entry_id, snippet, rank }`. `400` if `q` is missing/blank. Rate-limited 60/min. **`snippet`'s exact contract is item 3 below — read it before writing any search-rendering code.**

**Export + audit**
- `GET /api/incidents/:id/export.pdf` (session — member or demo) → `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment`. Rate-limited 20/hour.
- `GET /api/incidents/:id/export.md` (session — member or demo) → `200`, `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment`. Same rate limit (shared bucket with the PDF export).
- `GET /api/workspaces/:id/audit` (owner role required — **a demo grant resolves to `owner`, so demo visitors can view this**, see item 6) query `limit?(default 100,max 500), offset?` → `200 { entries: [...] }`, newest first. Each entry: `{ id, workspace_id, actor_user_id, action, target_type, target_id, at, payload_json, prev_hash, hash }` — `payload_json` is a **parsed object**, not a string (per `SPEC.md`'s naming decision — render its keys directly, no `JSON.parse()` needed or expected).
- `GET /api/workspaces/:id/audit/verify` (owner role required, same demo note as above) → `200 { valid: true, checked: n }` or `200 { valid: false, checked: n, broken_at_id: "<id>" }` — always `200`; a broken chain is a correct, successful answer from the verifier, not an HTTP error.

Export buttons and the evidence download button should all be plain
browser navigations (`<a href="...">` or `window.location = ...`), not
`fetch` + blob-URL — the browser's native download flow already handles
the file correctly and this avoids re-implementing streaming/attachment
handling client-side.

## Things that changed after an earlier draft of this brief was written

An earlier draft of this brief was written before a single endpoint
existed. Everything below is real, shipped behavior an implementing agent
must build against — verified line-by-line against the merged route files,
not assumed:

### 1. Naming convention

Every table above already reflects the target `snake_case` convention.
Build against those field names. See the merge-order note at the top of
this brief for why: a small normalization PR is expected to land on `main`
before this round starts.

### 2. `POST /api/demo` requires a same-origin request, and never double-creates

`src/routes/demo.js` rejects any request whose `Origin`/`Referer` header
doesn't match the request's own `Host` with `403 { error: "Invalid
origin" }` — this only matters if you ever call it from something other
than the page's own same-origin `fetch()` (which is always same-origin
automatically; do not add any cross-origin workaround for this). Separately,
if the caller's session already holds a live demo grant (an unexpired
`is_demo=1` workspace matching `req.session.demoWorkspaceId`), a second
`POST /api/demo` call returns the **existing** workspace/incident pair at
`200`, not a freshly seeded second one at `201`. Practically: the "Try the
live demo" button can be clicked more than once (double-click, browser
back-button, a second tab) without ever creating two demo workspaces for
the same visitor — treat both `200` and `201` from this endpoint as
success and redirect into `/app/incident.html?id=<incident_id>` either way.

### 3. Search snippets — the most important section in this brief

`GET /api/workspaces/:id/search` returns `results[].snippet` as a string
that is **already HTML-escaped by the server**, with match highlights
marked using literal `<b>`/`</b>` tags the server inserts *after*
escaping everything else (`src/services/search.js`: SQLite `snippet()`
runs with non-HTML sentinel markers, the whole result is HTML-escaped,
then the sentinels are swapped for `<b>`/`</b>` — so the only unescaped
angle brackets in the string are the server's own `<b>`/`</b>` pair,
never anything from the matched text).

**The exact rule for rendering it**: `snippet` is the *one and only*
field anywhere in this entire API that is safe to assign directly via
`element.innerHTML = result.snippet` — and even then, only that exact
value, assigned alone, never concatenated with any other string first
(concatenating it with anything else — a title, a query echo, another
field — before the `innerHTML` assignment reintroduces exactly the hole
the server-side escaping closed). Every other string returned by this API
(entry `body_md`, incident `title`/`summary`, evidence `filename`,
technique `name`, workspace `name`, audit `action`/`payload_json` values,
literally everything else) is **not** pre-escaped for HTML and must go
through `markdown.mjs`'s renderer (for `body_md`) or a plain text-node
assignment (`textContent`, or a templating approach that escapes by
default) for everything else — never a raw `innerHTML` assignment.

### 4. Live stream: connection cap + reconnect-then-backfill

`GET /api/incidents/:id/stream` is capped at **5 concurrent connections
per session** (`src/routes/incidents.js`, `SSE_MAX_PER_SESSION = 5`,
tracked per `sessionID`/user id/demo workspace id). A 6th simultaneous
connection attempt from the same session gets `503 { error: "Too many
concurrent stream connections" }` at the HTTP level — but note that a
browser's native `EventSource` does not expose the HTTP status code or
body of a failed connection attempt to your JavaScript, only a generic
`error` event, so you cannot special-case this response distinctly from
any other connection failure. The practical rule: `sse.js` must open
**exactly one** `EventSource` per incident view, and must close the
previous one before opening a new one on navigation (never leave a stale
connection open when moving to a different incident or away from the
page) — normal single-tab usage never gets remotely close to the cap.
If the cap is ever hit anyway (e.g. many tabs open on the same incident),
treat it exactly like any other prolonged connection failure: the
existing debounced connection-status indicator (`DESIGN.md` §6.12) will
show "Reconnecting…" then "Offline" per its normal 2-second-grace rule —
no separate UI is needed for this case specifically.

Event contract (unchanged from `SPEC.md` §6, field names now `snake_case`):
`entry.created` (full entry object, same shape as the entries endpoints),
`incident.updated` (`{ id, changes: { field: newValue } }`),
`entry.technique_tagged` (`{ entry_id, technique_id }`, fired once per tag
immediately after `entry.created`), `evidence.uploaded` (same shape as the
evidence endpoints). On every `EventSource` `open` event (first connect
*and* every reconnect), call `GET /api/incidents/:id/entries?since=<last
seen entry id>` once to backfill anything missed during the gap, then keep
consuming the live stream — there is no server-side replay buffer, this
client-side backfill is the entire correctness mechanism.

### 5. Rate limits — handle `429`/`503` gracefully, don't look broken

These endpoints are now rate-limited and will return `429` with a
`Retry-After` header (seconds) once a caller exceeds the limit, or `503`
(no `Retry-After` header) if the limiter's own storage check fails
(fail-closed, per `AGENTS.md` §4 — treat identically to `429` in the UI):

| Endpoint | Limit |
|---|---|
| `GET /api/workspaces/:id/search` | 60/minute |
| `GET /api/incidents/:id/export.pdf` and `.export.md` (shared bucket) | 20/hour |
| `POST /api/incidents/:id/evidence` | 30/hour |
| `GET /api/techniques` | 60/minute |
| `GET /api/incidents/:id/matrix` | 60/minute |

(Registration and login have their own, longer-standing limits — 5/hour
and 10-failed/15min respectively — already present before this round;
handle their `429`s the same way.) `public/js/api.js`'s fetch wrapper
must surface a `429`/`503` as its own distinguishable error type (reading
`Retry-After` when present) so every caller can show "Too many requests —
try again in Ns" (or, for a `503` with no header, a generic "try again
shortly") instead of falling through to a generic error toast that reads
like the feature is broken.

### 6. Cross-tenant vs. not-found — byte-identical, never distinguish them

A request for an incident/entry/evidence item that exists but belongs to
a workspace the caller isn't a member of returns the exact same `404`
body as a request for an id that doesn't exist at all
(`{"error":"Incident not found"}` etc.) — this is deliberate (`SPEC.md`
§5's cross-tenant existence rule), so the UI must render a single generic
"not found" state for any `404` and must never attempt to tell these two
cases apart or hint that "it exists somewhere else."

### 7. What a demo visitor can and cannot do — read this before building any role-gated control

`DESIGN.md` §6.4/§8.5 already say owner-only controls must be hidden
(not just disabled) for roles that lack the permission. Demo visitors are
**not** any of the three real roles (`owner`/`analyst`/`viewer`) and their
allowed actions do not map cleanly onto any single one of them — do not
reuse "hide it like a viewer" logic for demo mode. Verified directly
against the route guards:

**How to detect demo mode**: `GET /api/auth/session` returns `user: null`
for a demo visitor exactly as it would for a fully logged-out visitor —
it is *not* how you detect demo mode. Instead, call
`GET /api/workspaces/:id` for the workspace you're viewing and check its
`workspace.is_demo` flag. A demo grant always resolves to `role: 'owner'`
on that same response, but **owner-shaped `role` does not mean the same
action set as a real owner when `is_demo` is true** — several actions that
`role: 'owner'` would normally unlock are still refused for a demo session
specifically, because they require a real logged-in account
(`src/middleware/workspace-guard.js`'s `requireUser`), not merely
workspace access:

| Action | Demo visitor |
|---|---|
| View incidents, entries, matrix, techniques, search results | **Allowed** |
| Live timeline (SSE stream) | **Allowed** |
| Upload evidence | **Allowed** |
| View/download evidence, view custody trail | **Allowed** |
| Export PDF / Markdown | **Allowed** |
| View audit log + run "Verify integrity" | **Allowed** (a demo grant's `owner`-equivalent role passes the audit route's owner check) |
| Create a new incident | **Refused (`401`)** |
| Edit an incident's severity or status | **Refused (`401`)** |
| Add a timeline entry | **Refused (`401`)** |
| Create a workspace, invite a member, create/list/revoke an API token | **Refused (`401`)** |

So on an `is_demo` workspace: show the timeline, matrix, evidence list
(with a working upload control), search, export buttons, and the Audit
tab exactly as for a real owner — but hide the "New incident" button, the
entry composer, and the severity/status edit controls (same visual
treatment as hiding them for a `viewer`), and never surface "Invite" or
"API tokens" controls in settings for a demo session at all (there is no
real workspace-settings concept for an anonymous demo grant). If in doubt
for any action not listed above, check whether its route uses
`requireUser` (real account only) or `requireSession`/`requireWorkspace`
alone (session or demo) in `src/middleware/workspace-guard.js` and the
route file itself — the table in "The real API surface" section above
already notes this per endpoint ("real account only" vs. "session —
member or demo").

### 8. Evidence downloads are forced attachments, never inline

`GET /api/evidence/:id/download` always responds
`Content-Type: application/octet-stream` and
`Content-Disposition: attachment; filename="<sanitized display name>"`,
regardless of the file's real type — the server deliberately never gives
the browser a reason to render a file inline. Use a plain link/navigation
for the download button (`<a href="/api/evidence/:id/download">
Download</a>`, or `window.location = ...` from a button handler) exactly
like the export buttons — never `fetch()` + blob-URL construction for
this, the server's headers already do the right thing.

## What to build

Every page/flow in `SPEC.md` §2 and every component in `DESIGN.md` §6,
against the verified API surface above, specifically:

1. **Landing page** (`DESIGN.md` §7) — hero, "Start free" → register,
   "Try the live demo" → `POST /api/demo` then redirect into
   `/app/incident.html?id=<incident_id>` for the seeded demo incident
   (item 2 above covers the repeat-click case).
2. **Register / Login** — forms posting to the auth endpoints above,
   plus a "Continue with Google" button. Every form validates client-side
   *and* renders the server's actual error message on `4xx` (never a
   generic "something went wrong" when the API returned a specific
   `error` string).
3. **Dashboard** (`public/app/dashboard.html`) — incident list (`DESIGN.md`
   §6.2), "New incident" modal (`DESIGN.md` §6.11, hidden entirely in
   demo mode per item 7 above), workspace switcher if the user has more
   than one workspace.
4. **Incident detail** — header (`DESIGN.md` §6.4) with severity/status
   pill editing (owner/analyst only — hidden, not disabled, for `viewer`
   *and* for a demo session per item 7), four tabs:
   - **Timeline**: entry cards (`DESIGN.md` §6.5), an entry composer
     (kind picker, technique picker for `technical` entries — a modal per
     `DESIGN.md` §6.11 with search backed by `GET /api/techniques?q=`,
     hidden for `viewer` and for demo per item 7), live updates via
     `public/js/sse.js` (item 4 above — one connection per view, reconnect-
     then-backfill, the 5-connection cap), the "New" marker behavior from
     `DESIGN.md` §6.5, and the connection-status indicator from `DESIGN.md`
     §6.12 — **build the 2-second debounce exactly as specified, do not
     wire the indicator directly to raw connect/disconnect events**; a
     prior project on this box shipped that shortcut and it flickered
     visibly on every brief connection flap, which is the specific mistake
     §6.12 exists to prevent.
   - **Matrix**: the full ATT&CK coverage grid (`DESIGN.md` §6.7),
     keyboard-operable cells, popover listing tagged entries.
   - **Evidence**: upload control (allowed for demo, item 7) + evidence
     cards (`DESIGN.md` §6.8), custody trail expansion, download button
     as a plain navigation link (item 8).
   - **Audit** (owner role required by the API, which includes demo
     sessions per item 7 — render it for any session whose resolved role
     is `owner`, real or demo; hidden entirely for `analyst`/`viewer`):
     paginated audit log table (rendering `payload_json` as the parsed
     object the API now returns, not a string to re-parse) + a "Verify
     integrity" button calling `.../audit/verify` and showing the result
     plainly ("Chain intact — N events checked" or "Tampering detected at
     event <broken_at_id>" with `--danger` styling).
   - Export buttons (PDF, Markdown) as direct browser navigations to the
     export URL (item 8's pattern) — allowed for demo sessions too.
5. **Settings** — member list + role, invite form (owner-only real
   account, shows the returned `invite_url` in a copyable field per
   `DESIGN.md` §6.8's copy-button pattern — no email is sent, per
   `SPEC.md` §2.9), API token create/list/revoke (owner-only real
   account, the raw token shown exactly once with a clear "copy this now,
   you won't see it again" warning). This entire page is unreachable/
   hidden for a demo session (item 7 — there is no real workspace-settings
   concept for an anonymous demo grant).
6. **Every list/detail view** implements all four states from `SPEC.md`
   §8.7 and `DESIGN.md` §6.9's exact empty-state copy per surface, and
   treats every `404` as the single generic "not found" state from item 6
   above, and every `429`/`503` as the rate-limit/retry state from item 5.
7. **"New since you last viewed"** (`DESIGN.md` §6.2) — on the dashboard's
   incident list, compare each incident's `last_activity_at` (already in
   the `GET /api/workspaces/:id/incidents` response) against a per-
   incident "last viewed" timestamp stored in `localStorage`, written the
   moment an incident's detail page is opened. No schema change, no new
   endpoint — this is entirely a client-side computation over data the
   API already returns.
8. **Search results** — rendered per item 3 above: `snippet` via a single,
   unconcatenated `innerHTML` assignment; every other field via
   `markdown.mjs` or a text-safe assignment. This is the one place in the
   whole frontend where a raw `innerHTML` assignment of API-returned
   content is correct — get the "only that one field, alone" rule right.
9. **`tests/frontend-markdown/markdown.test.js`** — a `node --test` file
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
  permission — this matches the backend's `401`/`403`, and prevents a
  confusing "why is this greyed out" state for a `viewer` (or a demo
  session, per item 7) who was never going to be allowed to do it.
- `public/js/markdown.mjs` must HTML-escape all `body_md` content before
  applying the Markdown subset transforms (`SPEC.md` §11) — this is the
  only thing standing between analyst-authored (potentially attacker-
  influenced, e.g. copy-pasted phishing content) text and stored XSS in
  every browser tab viewing the timeline. `results[].snippet` from search
  (item 3) is the sole exception to "never assign unescaped-by-you content
  via `innerHTML`" — it arrives pre-escaped from the server and must be
  assigned alone, never concatenated with anything else first.
- Never render a fabricated/placeholder incident, entry, or "demo" data on
  a *non-demo* page — every value shown must come from a real API
  response. Loading states show a skeleton/spinner, not fake sample
  content.
- Treat every `404` as the single generic "not found" state (item 6) —
  never build UI that tries to distinguish "doesn't exist" from "exists
  but isn't yours."

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
  entry in one (as an owner/analyst account, not demo — item 7), shows it
  appear in the other within a couple of seconds with no manual refresh.
- Killing the server, restarting it, and reloading a tab that was on the
  timeline still shows the full, correct entry list (proving the SSE
  reconnect-then-backfill pattern from item 4 works, not just the
  live-update path).
- A `viewer` account sees no severity/status edit controls, no entry
  composer, no upload control, and no Audit tab.
- A demo session (via "Try the live demo") sees no "New incident" button,
  no entry composer, and no severity/status edit controls, but *does* see
  a working evidence upload control, export buttons, and an Audit tab
  with a working "Verify integrity" button (item 7's table, exercised
  end to end).
- The landing page's "Try the live demo" button, with no prior account,
  lands the visitor inside a working, fully-seeded incident timeline
  within one click, and clicking it again (or reloading and clicking
  again) does not create a second demo workspace.
- Every empty state listed in `DESIGN.md` §6.9 has been triggered and
  screenshotted at least once (e.g. a brand-new workspace's empty
  dashboard, an incident with zero evidence, a search with zero results).
- A search whose query matches an entry renders the highlighted snippet
  correctly (visible `<b>` highlight on the matched term) without
  executing any script, even when the underlying entry's original text
  contained HTML/script-like content — described and screenshotted in the
  PR (this is item 3's acceptance check, and it matters more than any
  other single item in this list).
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
- Triggering a rate limit (e.g. repeated rapid searches) shows a
  "too many requests, try again shortly" state rather than a generic
  error or a silently-broken-looking UI — described in the PR.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output (this round
adds exactly one automated test file, `tests/frontend-markdown/
markdown.test.js` — the rest of this brief has no automated coverage, by
design, per `AGENTS.md` §2's no-build-step/no-browser-test-tooling
constraints), **screenshots required** for every page/state listed in the
acceptance criteria, at both desktop and phone widths, SPEC.md/DESIGN.md
sections implemented, what was left out.

Branch from `main`, open a PR, do not merge.
