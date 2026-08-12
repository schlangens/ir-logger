# Devin brief — Round 1: Foundation

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`,
`DESIGN.md`, `ROADMAP.md`. This brief implements the "Round 1 — Foundation"
section of `ROADMAP.md`. Everything you build here is imported by every
later round — get the contracts right, since Round 2/3 sessions will not
be able to change them without their own separate approved PR.

## What you own (create/edit only these)

```
package.json
package-lock.json
.env.example
.gitignore                 (additions only — do not remove existing
                             entries; see item 2 for the exact new
                             entries, including the desktop sync tool's
                             config filename, added up front so Round 3b
                             never has to touch this file)
src/server.js               (sole, permanent owner — see ROADMAP.md: no
                              later round, in this build or any future
                              one, ever edits this file)
src/db/index.js
src/db/migrations/001_init.sql
src/db/migrations/002_seed_techniques.sql
src/middleware/workspace-guard.js
src/middleware/rate-limit.js
src/services/session-store.js
src/services/audit.js
src/uploads/storage.js
src/auth/passport.js
src/routes/auth.js
src/routes/health.js
src/routes/workspaces.js
src/sse/hub.js
tests/foundation/**

-- stub router files — you create AND mount every one of these; the
-- Round-2 brief named in each comment later fills in its contents, but
-- never touches src/server.js to do so:
src/routes/incidents.js     (stub — Round 2a fills in)
src/routes/entries.js       (stub — Round 2a fills in)
src/routes/search.js        (stub — Round 2a fills in)
src/routes/v1-ingest.js     (stub — Round 2a fills in)
src/routes/techniques.js    (stub — Round 2b fills in)
src/routes/evidence.js      (stub — Round 2c fills in)
src/routes/export.js        (stub — Round 2d fills in)
src/routes/audit.js         (stub — Round 2d fills in)
src/routes/demo.js          (stub — Round 2e fills in)

-- a second, smaller category: not a router, but wired into
-- src/server.js at boot the same way (a stub whose behavior does
-- nothing yet, filled in later without ever touching src/server.js):
src/services/demo-sweeper.js (no-op stub — Round 2e fills `sweep()` in;
                               you implement `start()` for real, since
                               it's the boot-time scheduling wiring)
```

Round 2e (`docs/devin-briefs/round2e-demo-sandbox.md`) owns the *content*
of `src/routes/demo.js`, `src/services/demo-sweeper.js`'s `sweep()`
function body, and an entirely new file, `src/services/demo-seed.js`
(which you never create — it doesn't get wired into `src/server.js`
directly, so there's nothing for you to stub; it's a plain service module
2e creates from scratch and only `src/routes/demo.js` imports it).

## Do not touch

`readme.md`, `ir-logger.py`, `requirements.txt`, anything under `public/`,
`docs/`, `SPEC.md`, `AGENTS.md`, `DESIGN.md`, `ROADMAP.md`,
`src/services/demo-seed.js` (you never create this file — see above). You
create the nine stub router files and the one stub service module listed
above (each router stub is just
`module.exports = require('express').Router();` plus a one-line comment
naming the `SPEC.md` section and the brief that fills it in;
`demo-sweeper.js`'s `sweep(db)` export is a real function that does
nothing yet — e.g. an immediate no-op return, with a comment saying Round
2e replaces the body) — beyond that stub content, do not write any real
incidents/entries/search/v1-ingest/techniques/evidence/export/audit/demo
route or service logic yourself; that belongs to the Round 2 briefs named
in each stub's comment.

## What to build

1. `package.json` with exactly the dependency list in `AGENTS.md` §1 (no
   more, no less, unless you write the "New dependency justification"
   section `AGENTS.md` requires). Scripts: `"start": "node
   src/server.js"`, `"test": "node --test tests/"`. Include
   `"engines": { "node": ">=22.12" }` — see `AGENTS.md` §1 for why this
   floor is pinned (short version: `nanoid` v5, already on the dependency
   list, is ESM-only).
2. `.gitignore` — add (without removing the existing
   `Incident_1001/Event_Report.md` line): `node_modules/`, `.env`,
   `.env.*` except `!.env.example`, `data/` (covers the SQLite database
   file, evidence uploads, and any other runtime state under `data/`),
   and `ir-logger-sync.json` (the desktop tool's future sync-config file
   from `SPEC.md` §2.10 — it doesn't exist yet, nothing in this round
   creates it, but it's added here up front so Round 3b's brief never
   needs to touch this file at all).
3. `.env.example` documenting: `PORT` (default `3059`), `SESSION_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL` (default
   `https://ir.scottslab.io`), `DB_PATH` (default
   `./data/ir-logger.db`), `NODE_ENV`.
4. `src/db/migrations/001_init.sql` — the full DDL from `SPEC.md` §4,
   verbatim.
5. `src/db/migrations/002_seed_techniques.sql` — `INSERT OR IGNORE`
   statements for every row in `SPEC.md` §2.2.1, with `url` built from the
   documented pattern.
6. `src/db/index.js` — opens `better-sqlite3` at `DB_PATH`, sets
   `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` immediately
   after opening, and applies any `src/db/migrations/*.sql` file not yet
   recorded in `schema_migrations`, in filename order, each in a
   transaction.
7. `src/middleware/workspace-guard.js` — the single exported function
   every later route calls to resolve `(caller, workspaceId) → role |
   deny`. Implements `SPEC.md` §8.2 exactly, including the demo-session
   path from §9 point 2 (this stays yours regardless of who builds the
   route that grants a demo session — see item 17 below). **Fail-closed**:
   any thrown error from the membership/session lookup must deny
   (403/404 per §5's cross-tenant rule), never allow.
8. `src/middleware/rate-limit.js` — a fixed-window limiter factory backed
   by the `rate_limits` table (`SPEC.md` §4, §8.3). Exported as something
   like `rateLimit({ bucket, max, windowMs })` returning Express
   middleware. **Fail-closed**: a thrown error from the `rate_limits`
   read/write must respond `503`, never allow the request through. State
   this in a code comment at the point of the catch block, not just in
   this brief. Round 2e's demo-creation route builds directly on this
   factory (bucket `demo`, 3/IP/24h) — you don't need any demo-specific
   code here, the generic factory is enough.
9. `src/services/session-store.js` — an `express-session`-compatible
   `Store` subclass backed by the `sessions` table (`SPEC.md` §4),
   implementing `get`, `set`, `destroy`, and a `touch` no-op or real touch
   (your choice, document which), plus a cleanup step for expired rows
   (its own simple interval here — do not couple this to
   `demo-sweeper.js`, which is a separate, unrelated interval owned by a
   different concern).
10. `src/services/audit.js` — `append(db, { workspaceId, actorUserId,
    action, targetType, targetId, payload })` and `verify(db, workspaceId)`
    implementing the hash-chain algorithm in `SPEC.md` §2.7 exactly
    (canonical JSON field order, per-workspace `rowid`-ordered chain,
    genesis `prev_hash`). No `UPDATE`/`DELETE` against `audit_log` anywhere
    in this file or anywhere else you touch.
11. `src/auth/passport.js` — `LocalStrategy` (bcrypt cost 12) and
    `GoogleStrategy`, per `SPEC.md` §5.2 and `AGENTS.md` §3's
    serialize/deserialize pattern.
12. `src/routes/auth.js` — `SPEC.md` §5.2 endpoints, including the login
    rate limiter (10/15min per IP) **and** the registration rate limiter
    (5/60min per IP, same fail-closed contract) via `rate-limit.js` —
    registration is unauthenticated and each account can create
    workspaces holding up to 200MB of evidence each, so this limiter is a
    required disk-exhaustion guard, not optional. Also implements session
    regeneration: `register`, `login`, and the Google OAuth callback each
    call `req.session.regenerate(...)` on success, before establishing
    the new authenticated session, and do **not** copy any pre-existing
    `req.session.demoWorkspaceId` into the regenerated session — a
    successful auth always starts from a clean session (`SPEC.md` §5.2's
    session-fixation note).
13. `src/routes/health.js` — `SPEC.md` §5.1.
14. `src/routes/workspaces.js` — `SPEC.md` §5.3 (create, list, get,
    invite, accept invite, API token create/list/delete). Every route uses
    `workspace-guard.js` for anything scoped to an existing workspace.
    Accept-invite looks up the raw `:token` by `sha256(token)` against
    `invites.token_hash` — the same pattern as `api_tokens.token_hash`
    later in this same file, never a raw-token column, never a raw-token
    comparison.
15. `src/uploads/storage.js` — exports a configured
    `multer.diskStorage(...)` instance (destination `data/evidence/`,
    filename a generated id) for Round 2c's evidence route to import.
    This module only configures storage location/naming; the per-request
    size-limit/cap logic in `SPEC.md` §5.7 (which depends on whether the
    target workspace is a demo workspace) is 2c's responsibility inside
    its own route, not yours — you're providing the disk-storage engine,
    not the evidence business rules.
16. `src/sse/hub.js` — `subscribe(incidentId, res)` registers a response
    stream (sets SSE headers, sends a 25s heartbeat comment on an
    interval, cleans up on `res.on('close', ...)`), `broadcast(incidentId,
    type, data)` writes a formatted SSE event to every subscriber of that
    incident. Per-process only (`SPEC.md` §6 — no `Last-Event-ID`
    persistence required).
17. `src/services/demo-sweeper.js` — the demo sandbox is Round 2e's
    (`docs/devin-briefs/round2e-demo-sandbox.md`), split out because it
    has no technical dependency on anything in 2a–2d and would otherwise
    make this round too large. Your job here is only the boot-time
    scheduling wiring, matching the stub-router pattern used everywhere
    else in this brief: export a real `start(db)` that runs `sweep(db)`
    on a 15-minute `setInterval`, and export `sweep(db)` itself as a
    genuine no-op for now (e.g. it returns immediately, with a comment
    that Round 2e replaces this body — `SPEC.md` §9 point 4 describes
    what the real implementation will do, but writing that is not your
    job). This mirrors the router-stub pattern: you create and wire the
    file, Round 2e edits its *content* (just `sweep()`'s body — leave
    `start()`'s signature and scheduling untouched, since `src/server.js`
    already calls it and nothing should need to change there).
18. The nine stub router files listed in "What you own" above — each is
    `module.exports = require('express').Router();` plus a one-line
    comment, e.g. `// SPEC.md §5.4/§5.5/§5.8 — filled in by Round 2a
    (docs/devin-briefs/round2a-incidents-entries-search.md)` — including
    `src/routes/demo.js`, whose comment names
    `docs/devin-briefs/round2e-demo-sandbox.md`.
19. `src/server.js` — wires everything per `AGENTS.md` §3: helmet CSP
    (self-only, per `AGENTS.md` §3's exact directive set), session
    middleware using `session-store.js` with `cookie: { sameSite: 'lax',
    httpOnly: true, secure: process.env.NODE_ENV === 'production' }` (see
    `AGENTS.md` §3 for why `'lax'` specifically), passport init, mounts
    `routes/auth.js`, `routes/health.js`, `routes/workspaces.js`, and all
    nine stub routers from item 18 (including `routes/demo.js`) at their
    final `SPEC.md` §5 paths, calls `demo-sweeper.js`'s `start(db)` once
    at boot (scheduling its currently-no-op `sweep(db)` — this call site
    does not change when Round 2e later fills `sweep()` in for real),
    serves `public/` via `express.static` (the directory may not have
    real content yet — that's fine, Round 3a fills it in), listens on
    `PORT`. This is the only file in the whole project that ever contains
    an `app.use(...)` mount call — every later round imports and fills in
    a router module, but none of them ever edits this file (`ROADMAP.md`).

## Fail-closed stances you must implement (not just acknowledge)

- Workspace guard: no membership/session match → deny. Guard's own query
  throwing → deny. No "assume the only workspace" fallback anywhere.
- Rate limiter: storage read/write throwing → `503`, not allowed-through.
  This is the contract Round 2e's demo-creation route relies on — you're
  not building that route, but the fail-closed guarantee has to actually
  hold in the shared factory 2e calls, so test it here, generically, not
  against any specific bucket.
- Audit log: append-only, enforced by never writing an `UPDATE`/`DELETE`
  statement against it.

## Acceptance criteria (testable)

- `npm install && npm test` passes with zero failing tests.
- A fresh checkout with a filled-in `.env` can run `npm start` and `curl
  localhost:3059/health` returns `200 {"status":"ok",...}`.
- A `node --test` case proves: registering a user, then calling
  `workspace-guard` for a workspace they don't belong to, returns a deny
  result (not a throw, not a silent allow).
- A `node --test` case proves: a simulated `rate_limits` table write
  failure (e.g. a stubbed `db.prepare` that throws) causes the limiter
  middleware to respond `503`, not to call `next()`.
- A `node --test` case proves: `audit.append()` called three times for the
  same workspace produces a chain where `verify()` returns `{valid:
  true}`; manually corrupting the middle row's `hash` column via a raw,
  clearly-commented test-only `db.exec` (not through `audit.js`) causes
  `verify()` to return `{valid: false, brokenAtId: <that row's id>}`.
- A `node --test` case proves two different workspaces' audit chains are
  independent (corrupting workspace A's chain doesn't affect workspace B's
  `verify()` result).
- `GET /api/auth/session` with no cookie returns `200 {user: null,
  workspaces: []}` (never errors, per `SPEC.md` §5.2).
- A `node --test` case proves: a 6th registration attempt from the same
  IP within the same rolling 60-minute window returns `429`; a simulated
  `rate_limits` storage failure on the registration limiter returns `503`
  (not allowed through).
- A `node --test` case proves: the session id issued after a successful
  registration (or login) is different from the session id the client
  held immediately beforehand, and that a session carrying a
  `demoWorkspaceId` grant loses it across a successful login (the new,
  regenerated session has no `demoWorkspaceId`).
- The session cookie's `Set-Cookie` header includes `SameSite=Lax`
  (verified by inspecting the header in a test, not just by reading the
  config).
- Migrations are idempotent: running `src/db/index.js`'s migration step
  twice against the same database file does not error and does not
  duplicate seeded technique rows.
- Every stub-router path returns `404`, not a crash or a `500` — e.g.
  `GET /api/incidents`, `GET /api/techniques`, `GET
  /api/incidents/x/evidence`, `GET /api/incidents/x/export.pdf`, and
  `POST /api/demo` each return `404` against a freshly booted server with
  only Round 1 merged, proving the stub routers (including `demo.js`,
  still empty at this point) are mounted and the server doesn't error
  just because a stub has no real routes yet.
- A `node --test` case proves: calling `workspace-guard.js` directly with
  a session whose `demoWorkspaceId` matches the workspace id being
  checked resolves to owner-equivalent access (not a deny) — this is the
  half of the demo-session contract that's actually yours; Round 2e's
  brief is responsible for proving the route that *sets*
  `demoWorkspaceId` in the first place works end to end, since that route
  is 2e's content, not yours.
- A `node --test` case proves: `demo-sweeper.js`'s `start(db)` is called
  exactly once at server boot and schedules `sweep(db)` on a 15-minute
  interval (assert via a spy/mock on `setInterval` or by calling
  `start()` directly and invoking the captured interval callback), and
  that calling the still-no-op `sweep(db)` does not throw and does not
  modify the database — proving the scheduling wiring is real even though
  the sweep behavior itself isn't yet.
- `.gitignore` includes `ir-logger-sync.json` (verified by a test or a
  documented manual check in the PR) so Round 3b never needs to add it
  itself.

## PR evidence required

Follow `AGENTS.md` §6 exactly: what changed, `npm test` full pasted
output, SPEC.md sections implemented (§4, §5.1, §5.2, §5.3, §6, §8.2,
§8.3, §8.4, §8.8, §9 point 2 only — the rest of §9 is Round 2e's, §10's
transaction-safety note applies once §5.4 exists in Round 2 but your
guard/service code must not preclude it), what was deliberately left out
(explicitly: the real `POST /api/demo` behavior, the demo seed scenario,
and the real sweep logic — all Round 2e's, per `ROADMAP.md`'s split). No
UI in this round, so no screenshots required.

Branch from `main`, open a PR, do not merge.
