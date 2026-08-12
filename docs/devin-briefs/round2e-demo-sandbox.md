# Devin brief — Round 2e: Demo sandbox

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`
(especially §2.8 and §9), `DESIGN.md`, `ROADMAP.md`. Round 1 (foundation)
must already be merged to `main` — branch from `main` after that merge.
Rounds 2a–2d may or may not be merged yet; this brief has no technical
dependency on any of them (the demo sandbox creates its own workspace,
incident, entries, and evidence directly against the database — it never
calls the incidents/entries/evidence routes those briefs own), so don't
wait on them. Seed and assert your own test rows directly via
`db.prepare(...).run(...)`, exactly as Round 2b's and Round 2d's briefs
already do for the same reason.

## What you own (create/edit only these)

```
src/routes/demo.js          (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/services/demo-sweeper.js (stub already created by Round 1 — Round 1
                              implemented `start()` for real; you replace
                              only `sweep()`'s no-op body with the real
                              implementation, keeping both exports' names
                              and signatures unchanged)
src/services/demo-seed.js    (new file — Round 1 never creates this one;
                              it's a plain service module, not wired into
                              src/server.js directly, so there's no stub
                              for you to fill in — you create it from
                              scratch)
tests/demo/**
```

`src/server.js` already mounts `src/routes/demo.js` at `POST /api/demo`
and already calls `src/services/demo-sweeper.js`'s `start(db)` at boot —
Round 1 did both. You never add, remove, or touch anything in
`src/server.js`, and you never change `demo-sweeper.js`'s `start()`
function or its exported name — only `sweep()`'s body.

## Do not touch

`src/server.js` (sole, permanent owner: Round 1 — see `ROADMAP.md`),
`src/middleware/**`, `src/services/audit.js`, `src/services/session-
store.js`, `src/uploads/storage.js`, `src/sse/hub.js`, `src/db/**`,
`src/auth/**`, `src/routes/auth.js`, `src/routes/health.js`,
`src/routes/workspaces.js`, `src/routes/incidents.js`,
`src/routes/entries.js`, `src/routes/v1-ingest.js`, `src/routes/search.js`,
`src/services/incidents.js`, `src/services/entries.js`,
`src/services/search.js` (2a), `src/routes/techniques.js`,
`src/services/techniques.js`, `src/services/matrix.js` (2b),
`src/routes/evidence.js`, `src/services/evidence.js`,
`src/services/custody.js` (2c), `src/routes/export.js`,
`src/routes/audit.js`, `src/services/export-*.js`,
`src/services/markdown-render.js` (2d), anything under `public/`,
`ir-logger.py`. If any of these appear to need a change to finish your
work, stop and describe the problem in your PR instead of editing them.

## What to build

Implement `SPEC.md` §2.8 and §9 exactly:

1. `src/services/demo-seed.js` — a function that, given an open
   transaction (or a `db` handle you wrap in your own transaction), inserts
   the full demo scenario from `SPEC.md` §9 point 1: the `workspaces` row
   (`is_demo=1`, `expires_at = now + 24h`), the `IR-DEMO-0001` incident,
   its 6 entries (with `entry_techniques` rows referencing technique ids
   that exist in Round 1's `002_seed_techniques.sql` — query the
   `techniques` table to confirm, do not hard-code an id you haven't
   verified is actually seeded), and the one fake evidence file (write
   real bytes to `data/evidence/`, compute its real `sha256`, insert the
   `evidence` row plus its `uploaded` custody event). Export this as a
   single function so `src/routes/demo.js` and your tests can both call it
   directly.
2. `src/services/demo-sweeper.js` — replace Round 1's no-op `sweep(db)`
   body with the real implementation of `SPEC.md` §9 point 4: find every
   `workspaces` row with `is_demo=1 AND expires_at < now`, and process
   each **independently** — wrap each workspace's cleanup in its own
   `try/catch` inside the loop, and on any error, log the workspace id
   and the error, then `continue` to the next expired workspace rather
   than letting one failure abort the whole sweep run. Per workspace, in
   one transaction: delete its evidence files from disk (treat `ENOENT`
   from the delete call as success, not failure — a file that's already
   gone is exactly the end state wanted), then delete its rows across
   `custody_events`, `evidence`, `entry_techniques`, `entries`,
   `incidents`, `audit_log`, `api_tokens`, `invites`, `memberships`, then
   the `workspaces` row itself. A workspace whose cleanup throws for a
   real reason (not `ENOENT`) is left in place (not deleted from
   `workspaces`) for the next tick to retry — its transaction rolls back,
   so it's never left half-deleted. After the loop, log one summary line
   (`swept N expired demo workspace(s), M failed`) to stdout. Do not
   touch `start()` — it already exists and already calls whatever
   `sweep(db)` exports, so replacing the body is sufficient; there is
   nothing to wire.
3. `src/routes/demo.js` — `POST /api/demo` per `SPEC.md` §5.3/§9: two
   independent fail-closed guards before any row is written — (a) Round
   1's `rate-limit.js` factory (bucket `demo`, 3/IP/24h — import the
   factory, do not reimplement limiting logic), and (b) a global ceiling
   check, `SELECT COUNT(*) FROM workspaces WHERE is_demo=1 AND expires_at
   > now`; if that count is `>= 25` or the query itself throws, deny
   `503` (same fail-closed handling as the rate limiter — a global cap
   isn't a "nice to have" here, since the per-IP limit alone doesn't stop
   an attacker rotating source addresses between sweeper runs). Once both
   guards pass, calls `demo-seed.js` inside one transaction, sets
   `req.session.demoWorkspaceId`, responds `{ workspaceId, incidentId }`.
   Use Round 1's `workspace-guard.js` conventions for consistency, though
   this route itself requires no prior auth (`SPEC.md` §5.3: `Auth: none`)
   — the guard only matters for requests *after* the session is granted,
   which is every other round's concern, not this route's.

## Fail-closed stances relevant to this brief

- The demo-creation rate limiter is Round 1's generic `rate-limit.js`
  factory, used here, not reimplemented: a `rate_limits` storage failure
  on the `demo` bucket must deny the request (`503`), never silently let
  an unlimited number of demo workspaces through. If you find the factory
  doesn't support what this route needs, say so in your PR rather than
  editing `src/middleware/rate-limit.js` yourself (that file is Round 1's).
- Demo workspace creation is otherwise unauthenticated by design
  (`SPEC.md` §5.3) — the rate limiter is the only gate, so it has to
  actually hold. Test the fail-closed behavior here, not just the
  happy path.
- The sweeper's per-workspace delete is one transaction: a workspace is
  never left half-deleted (some tables cleared, others not) if something
  fails partway through.
- The sweeper isolates failures per workspace: one workspace throwing
  never prevents the others in the same tick from being swept. This is a
  fail-closed concern too — a single stuck/corrupted demo workspace
  should never be able to jam the whole cleanup mechanism and let every
  other expired workspace pile up indefinitely.
- The global demo-count ceiling in `demo.js` fails closed identically to
  the rate limiter: a storage/query error while checking the count denies
  the request (`503`), it never falls back to "couldn't check, so allow."

## Acceptance criteria (testable)

- `POST /api/demo` with no prior session creates a `workspaces` row with
  `is_demo=1` and an `expires_at` approximately 24 hours out, seeds the
  `IR-DEMO-0001` incident with its 6 entries and their technique tags
  (each tag id verified to exist in the seeded `techniques` table), and
  seeds one evidence row whose `sha256` matches an independent hash of
  the file actually written to `data/evidence/`.
- The same request sets `req.session.demoWorkspaceId` to the created
  workspace's id, and — called against Round 1's `workspace-guard.js`
  directly (not through any 2a-owned route, whether or not it's merged
  yet) — that session resolves to owner-equivalent access for that
  workspace id.
- A 4th `POST /api/demo` call from the same IP within the same rolling
  24h window returns `429`; a simulated `rate_limits` storage failure on
  the same route returns `503`, not allowed through.
- A test that pre-populates 25 active (`is_demo=1`, unexpired) demo
  workspaces directly via `db.prepare(...).run(...)`, then calls `POST
  /api/demo` from a fresh IP (under the per-IP limit), gets `503`; a
  simulated failure of the global-count query also returns `503`. A test
  with 24 active demo workspaces present succeeds normally (the ceiling
  is exclusive at 25, not a fencepost-off-by-one).
- Calling `demo-sweeper.js`'s `sweep(db)` directly against a test database
  containing one already-expired demo workspace (with a real evidence
  file written to `data/evidence/` first, via `demo-seed.js` with a
  manually backdated `expires_at`) removes every row for that workspace
  across every table listed in `SPEC.md` §9 point 4, and deletes the
  evidence file from disk.
- Calling `sweep(db)` against an expired demo workspace whose evidence
  file was already deleted from disk beforehand (simulating `ENOENT`)
  still completes successfully and still removes all of that workspace's
  database rows — a missing file is not treated as a sweep failure.
- Calling `sweep(db)` against a test database with *two* expired demo
  workspaces, where cleanup of the first is forced to throw (e.g. a
  stubbed delete call that throws for that one workspace's id only),
  proves the second workspace is still fully swept (all its rows and its
  evidence file gone) despite the first one's failure — and the first
  workspace's `workspaces` row still exists afterward (left for the next
  tick), not partially deleted.
- Calling `sweep(db)` when there are zero expired demo workspaces is a
  no-op that doesn't throw and doesn't touch any non-expired workspace's
  rows (including a still-active demo workspace created in the same
  test).
- `npm test` passes, including all new test files, with zero regressions
  in Round 1's (and, if already merged, other Round 2) existing tests.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output, SPEC.md
sections implemented (§2.8, §9), what was left out. No UI in this round,
so no screenshots required.

Branch from `main`, open a PR, do not merge.
