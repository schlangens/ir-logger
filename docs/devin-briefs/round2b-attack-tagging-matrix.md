# Devin brief — Round 2b: ATT&CK reference data + coverage matrix

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`,
`DESIGN.md`, `ROADMAP.md`. Round 1 (foundation) must already be merged to
`main` — branch from `main` after that merge. Round 2a may or may not be
merged yet; your work only *reads* `entries`/`entry_techniques`, it never
writes them, so you do not depend on 2a being merged first (the
`entry_techniques` rows your matrix query reads simply won't exist yet in
a database that hasn't run 2a — your tests seed their own rows directly
for that reason, see below).

## What you own (create/edit only these)

```
src/routes/techniques.js    (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/services/techniques.js
src/services/matrix.js
tests/techniques/**
tests/matrix/**
```

`src/server.js` already mounts `src/routes/techniques.js` at
`/api/techniques` and `/api/incidents/:id/matrix` — Round 1 did that. You
never add, remove, or touch a mount line yourself; you only replace the
stub router's placeholder body with real routes.

## Do not touch

`src/server.js` (sole, permanent owner: Round 1 — see `ROADMAP.md`; not
even a one-line mount addition, since Round 1 already mounted your
router), `src/middleware/**`, `src/services/audit.js`, `src/services/
session-store.js`, `src/uploads/storage.js`, `src/sse/hub.js`,
`src/db/**`, `src/auth/**`, `src/routes/auth.js`, `src/routes/health.js`,
`src/routes/workspaces.js`, `src/routes/demo.js`,
`src/services/demo-seed.js`, `src/services/demo-sweeper.js` (2e),
`src/routes/incidents.js`, `src/routes/entries.js`, `src/routes/v1-
ingest.js`, `src/services/incidents.js`, `src/services/entries.js`,
`src/services/search.js`, `src/routes/search.js` (2a),
`src/routes/evidence.js`, `src/services/evidence.js`,
`src/services/custody.js` (2c), `src/routes/export.js`,
`src/routes/audit.js`, `src/services/export-*.js`,
`src/services/markdown-render.js` (2d), anything under `public/`,
`ir-logger.py`. In particular: **`entry_techniques` rows are written by
Round 2a's entry-create path, not by you** — you only read that table.

## What to build

1. `src/services/techniques.js` + `src/routes/techniques.js` — `SPEC.md`
   §5.6's `GET /api/techniques`: list all seeded techniques (from Round
   1's `002_seed_techniques.sql` data), with optional `tactic` (exact
   match) and `q` (case-insensitive substring match against `id` or
   `name`) filters. This endpoint is session-authenticated but not
   workspace-scoped (`techniques` is global reference data, per
   `SPEC.md` §4's table comment) — any logged-in user or demo session may
   call it.
2. `src/services/matrix.js` + the matrix route (add to
   `src/routes/techniques.js` or a route mounted from the same file — your
   choice, document which in the PR — matching `GET
   /api/incidents/:id/matrix`, `SPEC.md` §5.6): resolve the incident's
   workspace via `workspace-guard.js`, then return every seeded technique
   grouped by tactic in the fixed 14-tactic order from `SPEC.md` §2.2.1,
   each annotated with `count` = the number of *distinct entries* in this
   one incident tagged with that technique (`COUNT(DISTINCT
   entry_techniques.entry_id)` joined through `entries.incident_id =
   :id`). Techniques with no tags in this incident still appear, at
   `count: 0` — the matrix is always the full reference set, per
   `SPEC.md` §2.2.

## Fail-closed stances relevant to this brief

- The matrix endpoint resolves the incident's workspace via
  `workspace-guard.js` before running any query — a request for an
  incident in a workspace the caller doesn't belong to returns `404`,
  never partial matrix data.
- `GET /api/techniques` requires a session (real or demo) but has no
  workspace concept to guard — do not add a workspace check that doesn't
  apply to this endpoint; do not skip the session check either.

## Acceptance criteria (testable)

- `GET /api/techniques` returns exactly the seed set from `SPEC.md`
  §2.2.1 (same count, same ids) against a freshly migrated database.
- `GET /api/techniques?tactic=Persistence` returns only rows whose
  `tactic` exactly equals `"Persistence"`.
- `GET /api/techniques?q=phish` returns `T1566`, `T1566.001`,
  `T1566.002`, and `T1598` (case-insensitive substring match against
  `name`).
- `GET /api/incidents/:id/matrix` for an incident with zero tagged
  entries returns all seeded techniques at `count: 0`, grouped under all
  14 tactics in the exact order listed in `SPEC.md` §2.2.1.
- A test that directly inserts (via the test's own `db.prepare(...).run`
  calls against `entries`/`entry_techniques` — not by calling Round 2a's
  routes, since this brief doesn't depend on 2a) two entries both tagged
  `T1566.001` and one tagged `T1003.001` in the same incident, then calls
  the matrix endpoint, proves `T1566.001` shows `count: 2` and
  `T1003.001` shows `count: 1`.
- A request for `GET /api/incidents/:id/matrix` where `:id` belongs to a
  workspace the caller isn't a member of returns `404`.
- `npm test` passes, including all new test files, with zero regressions
  in Round 1's (and, if already merged, Round 2a's) existing tests.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output, SPEC.md
sections implemented (§2.2, §5.6), what was left out (note explicitly
that `entry_techniques` writes are Round 2a's responsibility, not
missing work on your part). No UI in this round, so no screenshots
required.

Branch from `main`, open a PR, do not merge.
