# ROADMAP.md — build order

Three rounds. Round 1 is sequential (everything else depends on it). Round
2 is five sub-briefs that touch disjoint files and can run concurrently
once Round 1 is merged. Round 3 is frontend + desktop sync + polish, run
after Round 2 for the frontend (it integrates against real endpoints), but
the desktop-sync sub-brief is fully independent and may run at any time.

```
Round 1 (sequential)
  └─▶ Round 2a, 2b, 2c, 2d, 2e (concurrent — disjoint files)
        └─▶ Round 3a frontend (after 2a–2e merged)
  Round 3b desktop sync (independent — may run anytime, any round)
```

## Merge order: Round 1 before Round 3b

Round 3b (desktop sync) may be *built* at any time, independent of the other
rounds (see above) — but it must not *merge* before Round 1. Round 1's
`.gitignore` additions include `ir-logger-sync.json`, the file the desktop
tool writes its API token into. Round 3b's branch was cut from an older
`main`, before that entry existed, so its own `.gitignore` does not ignore
that filename. Merging Round 3b first would leave a token-bearing file
untracked but *not* ignored on `main` — exactly the setup that lets a
credential get committed by accident on someone's next `git add .`. Round 1
must merge first so its `.gitignore` entry is already on `main` by the time
Round 3b lands.

This is a merge-ordering fact, not a defect in either round: Round 3b's brief
never owned `.gitignore` (see Round 1's "Owns" list below), so it was correct
not to edit it. The general rule for any later branch: if it was cut from an
older `main`, it inherits that older `.gitignore`. Before merging — or before
writing any code that saves a secret to disk — confirm the ignore rule it
depends on actually exists on the branch it's merging *into*, not just the
branch it was written on.

**`src/server.js` has exactly one owner for the life of this project: Round
1.** No later round — not 2a–2e, not 3a, not any round added after this
roadmap — ever edits it. Round 1 pre-creates a stub file at every path a
later round's route or scheduled-service module belongs at (for routers:
an empty `express.Router()` with a comment naming the `SPEC.md` section
and the brief that fills it in; for the one non-router case,
`src/services/demo-sweeper.js`, a real `start()` that schedules a
currently no-op `sweep()`) and mounts/calls every one of them, at its
final path, in `src/server.js` before Round 1 is done. Round 2 briefs
then edit the *contents* of their own stub file — never `src/server.js`
itself — so "Round 2a–2e touch disjoint files" is true because the one
file they'd otherwise collide on (`src/server.js`) was never theirs to
touch in the first place.

---

## Round 1 — Foundation

Delivers `SPEC.md` §4 (data model + migrations), the seeded technique
reference data (§2.2.1), §5.1 health, §5.2 auth (including Google OAuth
and the SQLite session store), the demo sandbox's shared plumbing only —
the route and sweeper *stubs*, workspace-guard's demo-session support
(§9 point 2), and the shared rate-limiter factory the demo route builds
on (§8.3) — with the demo scenario and sweep logic themselves split out
to Round 2e (see below; Round 1 was carrying too much for one session),
§8.2 workspace guard, §8.3 rate limiting helper, §8.4 audit-log append
engine (`verify` logic — the HTTP route exposing it is Round 2d), §6 SSE
plumbing (the reusable broadcast hub — the per-incident route mounting it
is Round 2a), the `node:test` + `supertest` harness itself, and **sole,
permanent ownership of `src/server.js`**, including pre-creating and
mounting a stub router (or, for the sweeper, a stub service module) for
every file a later round will fill in.

**Owns:**

```
package.json, package-lock.json
.env.example
.gitignore (additions only — evidence/session data dirs, and the desktop
            sync tool's config filename, added up front so Round 3b never
            has to touch this file)
src/server.js                        (sole owner, permanently — no later
                                       round ever edits this file)
src/db/index.js
src/db/migrations/001_init.sql
src/db/migrations/002_seed_techniques.sql
src/middleware/workspace-guard.js
src/middleware/rate-limit.js
src/services/session-store.js
src/services/audit.js
src/uploads/storage.js               (the multer disk-storage config used
                                       by evidence upload — exported for
                                       Round 2c to import; 2c configures
                                       nothing in src/server.js)
src/auth/passport.js
src/routes/auth.js
src/routes/health.js
src/routes/workspaces.js   (POST/GET/invite/accept/tokens — §5.3, since
                             workspace CRUD itself is foundational, not a
                             "feature" sub-round)
src/sse/hub.js
tests/foundation/*.test.js

-- stub router files, pre-created here and mounted in src/server.js at
-- their final path, then filled in with real logic by the round noted:
src/routes/incidents.js    (stub — filled in by Round 2a)
src/routes/entries.js      (stub — filled in by Round 2a)
src/routes/search.js       (stub — filled in by Round 2a)
src/routes/v1-ingest.js    (stub — filled in by Round 2a)
src/routes/techniques.js   (stub — filled in by Round 2b)
src/routes/evidence.js     (stub — filled in by Round 2c)
src/routes/export.js       (stub — filled in by Round 2d)
src/routes/audit.js        (stub — filled in by Round 2d)
src/routes/demo.js         (stub — filled in by Round 2e)

-- one stub service module: not a router, but wired into src/server.js
-- at boot the same way (called, not mounted) and filled in later without
-- ever touching src/server.js:
src/services/demo-sweeper.js (`start()` implemented for real here — it's
                               boot-time interval scheduling, genuinely
                               Round 1's job; `sweep()` is a no-op stub
                               body — filled in for real by Round 2e)
```

Each router stub file is a complete, valid, tiny module —
`module.exports = require('express').Router();` plus a one-line comment
naming the `SPEC.md` section and the Round-2 brief responsible for filling
it in — not an empty file. `src/server.js` mounts every one of them at its
final `SPEC.md` §5 path, and calls `demo-sweeper.js`'s `start(db)`, before
Round 1 is considered done. Ownership of *editing the contents* of each
stub file (and, for the sweeper, just its `sweep()` body) transfers to the
Round 2 brief named in its comment (see each brief's "Owns" list);
ownership of `src/server.js` itself, and of ever adding, removing, or
changing a mount/call line in it, never transfers — it stays with Round 1
for the life of the project. `src/services/demo-seed.js` is a third demo-
related file but is not part of this stub pattern at all — nothing in
`src/server.js` references it directly, so Round 1 never creates it; it's
a plain service module Round 2e creates from scratch (see Round 2e below).

**Deliverables:**

- Schema + migrations exactly matching `SPEC.md` §4, applied automatically
  at boot, idempotent on repeat runs.
- Working registration, login, logout, Google OAuth, and `GET
  /api/auth/session`, all backed by the SQLite session store (not the
  default in-memory `express-session` store).
- `workspace-guard.js` exporting the single helper every later route
  imports; unit tests proving it fail-closes on no-session, wrong-
  workspace, and simulated storage-error cases.
- `rate-limit.js` exporting a generic fixed-window limiter factory over
  the `rate_limits` table; unit tests proving fail-closed behavior on a
  simulated storage error.
- `audit.js` exporting `append()` and `verify()` per `SPEC.md` §2.7/§8.4;
  unit tests covering: a clean chain verifies true, a tampered row's hash
  is detected, a tampered `prev_hash` is detected, and per-workspace chain
  isolation (workspace A's chain is unaffected by workspace B's writes).
- `sse/hub.js` exporting a `subscribe(incidentId, res)` /
  `broadcast(incidentId, type, data)` pair used by later rounds; a
  foundation test proves a broadcast reaches a subscribed connection and
  heartbeats are sent on the documented interval.
- Full workspace CRUD + invite + API token routes (§5.3).
- `GET /health` per §5.1.
- `workspace-guard.js` resolving a session with a matching
  `demoWorkspaceId` to owner-equivalent access for that one workspace
  (§9 point 2) — the demo-session *contract*, not the route that grants
  one (that's Round 2e's).
- Every stub router file listed above, created and mounted, including
  `src/routes/demo.js` (still an empty router — Round 2e fills it in).
- `src/services/demo-sweeper.js`'s `start(db)` called once at boot,
  really scheduling `sweep(db)` on a 15-minute interval, even though
  `sweep()` itself is a genuine no-op until Round 2e replaces its body.

**Acceptance:** `npm test` passes; a fresh clone with only `.env` filled in
can `npm install && npm start` and serve `GET /health` returning `200`;
every stub-router path (e.g. `GET /api/incidents`, `POST /api/demo`)
returns `404`, not a crash or a `500`, proving the empty routers are
mounted and wired correctly; a test calling `workspace-guard.js` directly
with a session whose `demoWorkspaceId` matches the workspace id being
checked resolves to owner-equivalent access (not a deny); a test proves
`demo-sweeper.js`'s `start(db)` is called once at boot and schedules
`sweep(db)` on the documented interval, and that calling the still-no-op
`sweep(db)` doesn't throw and doesn't touch the database. (`POST
/api/demo`'s actual behavior — creating a workspace, seeding the demo
incident, granting a working session end to end, rate-limiting repeat
creations, and the sweeper actually deleting expired workspaces — is
Round 2e's acceptance criteria, not Round 1's; see Round 2e below.)

---

## Round 2 — parallel feature work

All five sub-rounds import Round 1's `workspace-guard`, `rate-limit`,
`audit`, `session-store`, and `sse/hub` modules but never modify them. Each
sub-round fills in the contents of the stub file(s) Round 1 already
created and mounted (or, for 2e's sweeper, called) for it (see Round 1's
"Owns" list above) — none of them ever edits `src/server.js`, which is why
they touch disjoint files and may be assigned to five separate Devin
sessions running at the same time. 2e (the demo sandbox) additionally has
no technical dependency on 2a–2d's route logic — it seeds and reads its
own rows directly through the database, the same way 2b and 2d already do
for their own reasons — so it's as safe to run concurrently with them as
they are with each other.

### 2a — Incidents, entries, search

Delivers §5.4 (incidents, including enforcing the demo-workspace 5-incident
cap from §9 point 3 — creating a 6th incident in an `is_demo=1` workspace
returns `409`), §5.5 (entries, including the denormalized `author_name`
join required by §5.5's response shape), §5.8 (search), §2.1 (live
timeline via the Round 1 SSE hub), §2.5 (full-text search), §10 (ref
generation), and the server-side half of §11 (Markdown render for entries
returned by the API — note: the API returns raw `body_md`, not
pre-rendered HTML; rendering happens client-side in Round 3a and
server-side only inside PDF export in Round 2d — so 2a itself does not
need the renderer, only stores/returns raw Markdown text. Listed here so
the boundary is explicit and 2a doesn't accidentally duplicate it.)

**Owns:** the *contents* of the stub files `src/routes/incidents.js`,
`src/routes/entries.js`, `src/routes/search.js`, `src/routes/v1-
ingest.js` (all pre-created and already mounted in `src/server.js` by
Round 1 — you fill them in, you do not mount them), plus
`src/services/incidents.js`, `src/services/entries.js`,
`src/services/search.js`, `tests/incidents/*`, `tests/entries/*`,
`tests/search/*`.

**Do not touch:** `src/server.js` (sole, permanent owner: Round 1 — do not
add, remove, or reorder any mount line in it), anything under
`src/middleware/`, `src/services/audit.js`, `src/services/session-
store.js`, `src/uploads/storage.js`, `src/sse/hub.js`, `src/db/`,
`src/routes/workspaces.js`, `src/routes/auth.js`, `src/routes/health.js`,
`src/routes/demo.js`, `src/services/demo-seed.js`,
`src/services/demo-sweeper.js` (2e), `src/routes/techniques.js`,
`src/routes/evidence.js`, `src/routes/export.js`, `src/routes/audit.js`,
anything under `public/`, `ir-logger.py`.

### 2b — ATT&CK tagging + matrix

Delivers §2.2 (technique tagging: the `technique_ids` handling lives
inside the entry-create path owned by 2a, so 2b's job is the *reference
data endpoints* and the *matrix aggregation*), §5.6.

**Owns:** the *contents* of the stub file `src/routes/techniques.js`
(pre-created and already mounted in `src/server.js` by Round 1 — you fill
it in, you do not mount it), plus `src/services/techniques.js`,
`src/services/matrix.js`, `tests/techniques/*`, `tests/matrix/*`.

**Do not touch:** `src/server.js` (sole, permanent owner: Round 1),
`src/routes/entries.js`, `src/services/entries.js` (entry-create's
`technique_ids` validation/insert into `entry_techniques` is owned by 2a,
since it's part of the entry-write transaction — 2b only reads
`entry_techniques`/`techniques` for the matrix and reference-data list),
and the same "do not touch" list as 2a otherwise.

### 2c — Evidence + custody

Delivers §2.3, §5.7, §7 (evidence security stances: hashing on ingest,
never-original-content-type downloads, sanitized display filenames,
generated stored paths).

**Owns:** the *contents* of the stub file `src/routes/evidence.js`
(pre-created and already mounted in `src/server.js` by Round 1 — you fill
it in, you do not mount it, and you configure no multer storage in
`src/server.js` — import the already-configured instance from Round 1's
`src/uploads/storage.js` instead), plus `src/services/evidence.js`,
`src/services/custody.js`, `tests/evidence/*`, `tests/custody/*`. May add
`data/evidence/` as a runtime directory (created at boot if missing, not
committed — already covered by Round 1's `.gitignore` additions).

**Do not touch:** `src/server.js` (sole, permanent owner: Round 1),
`src/uploads/storage.js` (Round 1 — import it, never redefine or
reconfigure multer yourself), and the same "do not touch" list as 2a,
plus `src/routes/techniques.js`, `src/services/matrix.js`.

### 2d — Export + audit route + reports

Delivers §2.6 (PDF + Markdown export), §2.7's HTTP surface (`GET
/api/workspaces/:id/audit` and `/audit/verify` — the underlying
`append()`/`verify()` engine is Round 1's `src/services/audit.js`, used
here, not modified here), and the server-side Markdown renderer from §11
(used for PDF/Markdown layout only).

**Owns:** the *contents* of the stub files `src/routes/export.js` and
`src/routes/audit.js` (both pre-created and already mounted in
`src/server.js` by Round 1 — you fill them in, you do not mount them),
plus `src/services/export-pdf.js`, `src/services/export-markdown.js`,
`src/services/markdown-render.js`, `tests/export/*`, `tests/audit-route/*`.

**Do not touch:** `src/server.js` (sole, permanent owner: Round 1),
`src/services/audit.js` (Round 1 — import and call `verify()`/read
`audit_log`, never redefine the hashing logic), and the same "do not
touch" list as 2a.

### 2e — Demo sandbox

Delivers §2.8 and §9 in full: the demo scenario itself and the sweep
logic — split out from Round 1 because neither has any technical
dependency on 2a–2d's route logic (it seeds and reads its own rows
directly through the database, the same way 2b and 2d already do) and
Round 1 was carrying too much for one session otherwise.

**Owns:** the *contents* of the stub file `src/routes/demo.js` and the
`sweep()` function body inside the stub file `src/services/demo-
sweeper.js` (both pre-created by Round 1 — `demo.js` is mounted at `POST
/api/demo`, and `demo-sweeper.js`'s `start()` is already called at boot;
you fill in their contents, you touch no wiring), plus an entirely new
file, `src/services/demo-seed.js` (Round 1 never creates this one — it's
a plain service module, not wired into `src/server.js` directly), and
`tests/demo/*`.

**Do not touch:** `src/server.js` (sole, permanent owner: Round 1),
`demo-sweeper.js`'s `start()` function (Round 1's — only its `sweep()`
body is yours), and the same "do not touch" list as 2a (all of 2a/2b/2c/
2d's owned files), plus `src/routes/techniques.js`, `src/services/
matrix.js`, `src/routes/evidence.js`, `src/routes/export.js`,
`src/routes/audit.js`.

---

## Round 3 — frontend, desktop sync, polish

### 3a — Frontend

Start this only after 2a–2e are merged to `main` (it integrates against
real endpoints, not mocks — the API surface in `SPEC.md` §5 is already
final, so there's no reason to build against a mock first; the demo flow
in particular needs 2e's real `POST /api/demo` and 2a's real incident-
reading routes both merged to work end to end). Delivers the
entire user-facing surface: `DESIGN.md` in full, every empty/loading/
error/success state (§SPEC 8.7), the landing page (`DESIGN.md` §7), the
demo flow (§SPEC 9) end to end, the timeline with live SSE updates, the
ATT&CK matrix, evidence cards + custody trail, search, export buttons, and
the audit/verify view.

**Owns:** everything under `public/` (`public/index.html`,
`public/login.html`, `public/register.html`, `public/app/*.html` per
route, `public/css/tokens.css`, `public/css/components.css`,
`public/js/*.js` — one module per page/feature area mirroring the API
resource split (`incidents.js`, `entries.js`, `matrix.js`, `evidence.js`,
`search.js`, `export.js`, `audit.js`, `sse.js`, `markdown.js` — the
client-side half of §11), `public/fonts/*` (vendored Inter Variable +
JetBrains Mono, downloaded once and committed as binary font files —
not fetched from a CDN at runtime), `public/icons/*.svg` (self-hosted
sprite sheets per `DESIGN.md` §1.3/§6.9).

**Do not touch:** anything under `src/` or `ir-logger.py`. If a needed API
response shape doesn't match `SPEC.md` §5 exactly, flag the mismatch in
the PR description rather than changing the backend to match the frontend.

### 3b — Desktop sync (independent, may run at any point)

Delivers §2.10: the optional sync mode in `ir-logger.py` and `POST
/api/v1/ingest` was already delivered by whichever Round-2 session covers
v1 ingest — **decision**: `/api/v1/ingest` is small enough and
conceptually closest to entries, so it is owned by **2a** (`src/routes/
entries.js` or a small `src/routes/v1-ingest.js` — 2a's brief specifies
the exact file), not 3b. 3b is Python-only.

**Owns:** `ir-logger.py`, `requirements.txt` (only if a genuinely stdlib-
covered need arises — expected to remain unchanged), `readme.md` (only
the v1 usage-instructions section describing the new "Sync Settings"
button — not the top-of-file v2 pointer note, which is already written).

**Do not touch:** anything under `src/` or `public/`.

**Acceptance is manual** (v1 has no existing test framework and this
roadmap does not introduce one for a single-file Tkinter script): the
brief in `docs/devin-briefs/round3b-desktop-sync.md` states an explicit
manual verification checklist instead of an automated one.

**Integration gap, closed explicitly**: because this round is independent
and may run before Round 1/2a merge, its brief allows verifying against a
throwaway stub HTTP server. That is not sufficient on its own — the two
halves (desktop tool, hosted server) must actually talk to each other for
real at least once before launch, or they could both ship having never
been proven compatible. If Round 1 and Round 2a are already merged when
this round runs, the real-server check *is* this round's acceptance
criteria (no stub allowed). If this round runs first, its brief requires
flagging the stub-only verification explicitly in its PR, and the
"Desktop-to-web integration smoke test" item in the before-launch
checklist above is the mandatory follow-up once the other rounds land.

---

## File-set summary (for quick collision-checking)

| Round | Owns |
|---|---|
| 1 | `package.json`, `.env.example`, `.gitignore`, **`src/server.js` (sole, permanent owner)**, `src/db/**`, `src/middleware/**`, `src/services/session-store.js`, `src/services/audit.js`, `src/uploads/storage.js`, `src/auth/**`, `src/routes/auth.js`, `src/routes/health.js`, `src/routes/workspaces.js`, `src/sse/hub.js`, `tests/foundation/**`, plus the *creation and mounting/calling* (not the later content) of every stub in the rows below, including `src/routes/demo.js` and `src/services/demo-sweeper.js`'s `start()` (its `sweep()` body is 2e's) |
| 2a | *contents of* `src/routes/incidents.js`, `src/routes/entries.js`, `src/routes/search.js`, `src/routes/v1-ingest.js` (stub files created/mounted by Round 1, including `GET /api/incidents/:id/stream`, `SPEC.md` §5.10, inside `incidents.js`), `src/services/incidents.js`, `src/services/entries.js`, `src/services/search.js`, `tests/incidents/**`, `tests/entries/**`, `tests/search/**` |
| 2b | *contents of* `src/routes/techniques.js` (stub file created/mounted by Round 1), `src/services/techniques.js`, `src/services/matrix.js`, `tests/techniques/**`, `tests/matrix/**` |
| 2c | *contents of* `src/routes/evidence.js` (stub file created/mounted by Round 1), `src/services/evidence.js`, `src/services/custody.js`, `tests/evidence/**`, `tests/custody/**` |
| 2d | *contents of* `src/routes/export.js`, `src/routes/audit.js` (stub files created/mounted by Round 1), `src/services/export-pdf.js`, `src/services/export-markdown.js`, `src/services/markdown-render.js`, `tests/export/**`, `tests/audit-route/**`, `tests/fixtures/markdown-xss-payloads.js` (new — the shared XSS-payload fixture both 2d's and 3a's Markdown-renderer tests point at, per `docs/devin-briefs/round2d-export-reports.md`) |
| 2e | *contents of* `src/routes/demo.js` and `src/services/demo-sweeper.js`'s `sweep()` body (both stubs created/wired by Round 1), plus a new file `src/services/demo-seed.js` (not a stub — Round 1 never creates this one), `tests/demo/**` |
| 3a | `public/**`, `tests/frontend-markdown/**` (new — a `node:test` suite exercising `public/js/markdown.mjs`, the one file in `public/` using the `.mjs` extension, specifically so it can be `import()`ed directly by a Node test; reads, but never edits, 2d's `tests/fixtures/markdown-xss-payloads.js`) |
| 3b | `ir-logger.py`, `readme.md` (v1 usage section only) |

`src/server.js` appears only in Round 1's row, permanently — no other
round ever edits it, including the mount/call lines for the stubs those
rounds fill in. Rounds sharing a row never edit outside that row's list.
`tests/fixtures/markdown-xss-payloads.js` is the one file two different
rounds' tests both *read*: 2d creates and owns it, 3a only ever imports
it, never edits it — the same read-only-reference pattern 3a already uses
for `SPEC.md` itself. Any file not listed above that a session believes it
needs to create should be placed inside its own owned directory tree
(e.g. a new 2c helper goes under `src/services/` but must still avoid a
filename another round already owns).

---

## Tracked follow-ups

Work flagged during a round's PR review but deliberately deferred rather
than done piecemeal. Still agent-scoped, in-repo work — unlike the
before-launch checklist below — just not assigned to any round's
acceptance criteria yet.

- [ ] **Move inline SQL in `src/routes/auth.js` and
  `src/routes/workspaces.js` into service modules**, per `AGENTS.md` §3
  ("Services own all SQL... routers never write raw SQL inline"). Today
  `auth.js`'s `POST /register` (the email-uniqueness check and the
  `INSERT INTO users`) and `GET /session` (the workspace-list join), and
  every route in `workspaces.js` (`POST /workspaces`, `GET /workspaces`,
  `GET /workspaces/:id`, `POST /workspaces/:id/invite`, `POST
  /invites/:token/accept`, `POST /workspaces/:id/tokens`, `GET
  /workspaces/:id/tokens`, `DELETE /workspaces/:id/tokens/:tokenId`) call
  `db.prepare(...)` directly instead of through a `src/services/users.js`
  / `src/services/workspaces.js` module, unlike `audit.js` and
  `session-store.js` which already have their own service modules. This
  was raised, not fixed, in the Round 1 foundation PR: creating those two
  new service modules was outside Round 1's owned file set
  (`docs/devin-briefs/round1-foundation.md` lists exactly which files that
  session owns), and Round 2a–2e are about to add their own routes and
  service modules on top of today's file layout — restructuring `auth.js`
  and `workspaces.js` now risks colliding with work already in flight in
  those five concurrent sub-rounds. Do this once, across both files, after
  Round 2 (2a–2e) merges to `main`, rather than piecemeal per-round.

---

## Before-launch checklist

Everything above is agent-scoped work inside this repo. The items below
are **not** — they're real-world operator actions outside any agent's
file set (no session may touch nginx config or DNS, per `AGENTS.md` §5),
listed here so nothing falls through the gap between "the code is merged"
and "the code is safe to put in front of the internet":

- [ ] The nginx site for this app **overwrites** `X-Forwarded-For` with
  the real peer address (`proxy_set_header X-Forwarded-For $remote_addr;`)
  rather than appending to it. This is not the default shape of every
  site config on this box — confirm this site's config specifically, not
  by assumption (`SPEC.md` §8.8, `AGENTS.md` §3).
- [ ] `trust proxy` in `src/server.js` is set to `1` and the real request
  path is still exactly one hop (`browser → nginx → Node`) at deploy
  time — if that ever changes (see the next item), this needs revisiting
  together with it.
- [ ] The app's port (`3059` by default) is not reachable from outside
  the box directly — only nginx should be able to reach it (firewall/bind
  address check, same posture as this box's other Node apps).
- [ ] If this site is ever put behind the Cloudflare proxy (orange-cloud
  enabled, unlike its current DNS-only setup), the `X-Forwarded-For`/
  `trust proxy` handling above must be revisited together — Cloudflare
  adds its own hop and its own header conventions (`CF-Connecting-IP`),
  and the "exactly one trusted hop" assumption this app currently relies
  on would no longer hold as-is.
- [ ] Desktop-to-web integration smoke test (see `round3b-desktop-sync.md`
  §Acceptance and the note under Round 3b above): confirm `ir-logger.py`'s
  sync mode, run for real against the actual deployed server (not a
  stub), successfully lands an entry in the real hosted timeline. If
  Round 3b was executed before Round 1 and Round 2a were merged (its
  brief allows building against a stub server in that case), this
  real-server confirmation is still outstanding and must happen before
  launch — do not ship having only ever tested the two halves against
  each other's stand-ins.
