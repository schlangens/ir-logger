# Devin brief — Round 2a: Incidents, entries, search, v1 ingest

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`,
`DESIGN.md`, `ROADMAP.md`. Round 1 (foundation) must already be merged to
`main` — branch from `main` after that merge, not from your own copy of
Round 1's branch.

## What you own (create/edit only these)

```
src/routes/incidents.js     (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/routes/entries.js       (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/routes/v1-ingest.js     (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/routes/search.js        (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/services/incidents.js
src/services/entries.js
src/services/search.js
tests/incidents/**
tests/entries/**
tests/search/**
```

`src/server.js` already mounts all four of your route files at their
final `SPEC.md` paths (§5.4/§5.5/§5.8/§5.11) — Round 1 did that. You never
add, remove, or touch a mount line yourself; you only replace each stub
router's placeholder body with real routes.

## Do not touch

`src/server.js` (sole, permanent owner: Round 1 — see `ROADMAP.md`; not
even a one-line mount addition, since Round 1 already mounted your
routers), `src/middleware/**`, `src/services/audit.js`, `src/services/
session-store.js`, `src/uploads/storage.js`, `src/sse/hub.js`,
`src/db/**`, `src/auth/**`, `src/routes/auth.js`, `src/routes/health.js`,
`src/routes/workspaces.js`, `src/routes/demo.js`,
`src/services/demo-seed.js`, `src/services/demo-sweeper.js` (2e),
`src/routes/techniques.js`, `src/services/matrix.js`,
`src/services/techniques.js` (2b), `src/routes/evidence.js`,
`src/services/evidence.js`, `src/services/custody.js` (2c),
`src/routes/export.js`, `src/routes/audit.js`,
`src/services/export-*.js`, `src/services/markdown-render.js` (2d),
anything under `public/`, `ir-logger.py`. If any of these appear to need a
change to finish your work, stop and describe the problem in your PR
instead of editing them.

## What to build

1. `src/services/incidents.js` + `src/routes/incidents.js` — `SPEC.md`
   §5.4: create (auto-generating `ref` per §10, inside one transaction
   with the insert; if the target workspace has `is_demo=1` and already
   has 5 incidents, reject with `409` and create nothing — §9 point 3's
   per-demo-workspace cap), list (filters + pagination, each incident
   annotated with `entry_count` and `last_activity_at` computed at read
   time per §5.4), get (same annotated shape), patch (severity free for
   owner/analyst; status to/from `closed` gated to `owner`, `403`
   otherwise; every accepted change appended to `audit_log` via Round 1's
   `audit.append()`). Use `workspace-guard.js` (Round 1) for every route.
2. `src/services/entries.js` + `src/routes/entries.js` — `SPEC.md` §5.5:
   create (validates `kind` enum, defaults `occurred_at`, validates
   `technique_ids` against the `techniques` table and only accepts them
   when `kind='technical'`, inserts the entry + `entry_techniques` rows in
   one transaction, calls `audit.append()`, broadcasts `entry.created`
   then one `entry.technique_tagged` per tag via Round 1's `sse/hub.js`),
   list (with `since`/`kind`/`limit` per §5.5), get one — every entry
   response (create/list/get) joins `users` on `author_user_id` at read
   time and includes both `author_user_id` and `author_name` per §5.5's
   response-shape note. Entries are never updated or deleted by any route
   you write. **`GET /api/entries/:id` takes a bare entry id with no
   workspace/incident segment in its path — resolve tenant scope via
   `entries.incident_id → incidents.workspace_id → workspace-guard.js`
   exactly as `SPEC.md` §5.5 spells out, never a workspace id read from
   the request.** This is the specific route shape `AGENTS.md` §4 flags
   as the easy-to-get-wrong one; get it right on the first pass, not as a
   follow-up fix.
3. `src/services/search.js` + `src/routes/search.js` — `SPEC.md` §5.8:
   FTS5 `MATCH` query against `entries_fts` joined through `entries` →
   `incidents` → filtered to the caller's workspace (via
   `workspace-guard.js`, not a manual `workspace_id` filter you write
   yourself — reuse the guard's resolved workspace id), `bm25`-ranked,
   `snippet()` excerpts, max 50 results, `400` on missing/blank `q`. Build
   the `MATCH` argument exactly per §5.8's escaping rule (double any `"`
   in `q`, then wrap the whole query in one pair of double quotes) — never
   interpolate `q` into the FTS5 expression unescaped.
4. `src/routes/v1-ingest.js` — `SPEC.md` §5.11: two separate rate limits,
   both via Round 1's `rate-limit.js` factory, both fail-closed — (a) a
   per-IP limiter on failed token lookups only (bucket
   `v1-ingest-auth:<ip>`, 20/15min, checked *before* the token lookup
   runs; once an IP is over it, `429` immediately without querying
   `api_tokens`), and (b) the existing per-token limiter (60/min) for
   successfully authenticated requests. Token lookup itself: parse
   `Authorization: Bearer <token>`, look up by `sha256(token)` against
   `api_tokens.token_hash`, `401` if not found (and count it against
   limiter (a)), update `last_used_at` on success. Auto-creates the
   incident if `incident_ref` doesn't exist yet in the token's workspace,
   builds `body_md` per the category-prefix / author-provenance-suffix
   rule in §5.11, then reuses `entries.js`'s create logic (call the
   exported service function directly, don't duplicate the
   insert/broadcast/audit logic — import from `src/services/entries.js`,
   which you also own, so this is not a cross-file-ownership issue).
5. `GET /api/incidents/:id/stream` inside `src/routes/incidents.js` —
   `SPEC.md` §5.10/§6: this is the live-timeline mechanism §2.1 depends on
   and is otherwise unclaimed by any brief, so it's yours. Resolve the
   workspace/role via `workspace-guard.js` first (`session (member)` per
   §5.10 — reject a non-member before touching the response stream at
   all, same as every other route in this brief). On success, call Round
   1's `sse/hub.js` exported `subscribe(incidentId, res)` with the
   incident's id and the raw `res` — its documented signature already
   sets the SSE headers, sends the 25s heartbeat comment, and cleans up
   on `res.on('close', ...)` internally (`ROADMAP.md`'s Round 1 section
   and `src/sse/hub.js` itself), so this route is a thin guard-then-
   subscribe call, not a reimplementation of any of that. Do not write
   your own heartbeat, header-setting, or disconnect-cleanup logic here —
   if `subscribe()` as Round 1 built it turns out not to support what
   this route needs, say so plainly in your PR instead of changing
   `src/sse/hub.js` yourself (that file is Round 1's, permanently, per
   `ROADMAP.md`).

## Fail-closed stances relevant to this brief

- Every route resolves the workspace/role via `workspace-guard.js` before
  any read or write — a request for an incident/entry in a workspace the
  caller doesn't belong to returns `404` (cross-tenant rule, `SPEC.md`
  §5), never leaks existence via a `403`. This applies to the SSE stream
  route too: the guard runs, and denies, before `sse/hub.js`'s
  `subscribe()` is ever called — a rejected caller never gets an open SSE
  connection, even briefly.
- The v1 ingest rate limiter fails closed (`503`) on a storage error, per
  `AGENTS.md` §4 — do not add your own ad hoc limiter; call Round 1's
  `rate-limit.js` factory.
- Auth (token lookup) → workspace/role resolution → input validation →
  database write, strictly in that order, on every route.

## Acceptance criteria (testable)

- Creating two incidents in the same workspace in the same year produces
  refs `IR-<year>-0001` and `IR-<year>-0002`.
- `PATCH` an incident's `status` to `closed` as an `analyst` returns
  `403`; as an `owner` returns `200` and sets `closed_at`; reopening
  (status away from `closed`) as `analyst` returns `403`, as `owner`
  clears `closed_at`.
- Creating a `technical` entry with `technique_ids` results in matching
  `entry_techniques` rows and an SSE `entry.created` followed by
  `entry.technique_tagged` event(s) observed by a test subscriber attached
  to `sse/hub.js`.
- Creating a `timeline` entry with `technique_ids` in the request body
  ignores them (no `entry_techniques` rows created) — verified by a test,
  not just documented.
- `GET .../entries?since=<id>` returns only entries with a higher
  insertion order than `<id>`.
- Every entry object returned by create/list/get includes `author_name`
  alongside `author_user_id`; a test that changes the author's `name` in
  `users` after the entry was created, then re-fetches the entry, sees
  the updated name (proving it's a live join, not a value captured at
  write time).
- Creating a 6th incident in a workspace with `is_demo=1` and 5 existing
  incidents returns `409` and the workspace still has exactly 5 incidents
  afterward; creating a 6th incident in a non-demo workspace with 5
  existing incidents succeeds normally (the cap only applies to demo
  workspaces).
- Full-text search for a term only present in workspace A's entries
  returns zero results when called by a member of workspace B.
- A search `q` containing FTS5 special characters (e.g. `"foo" OR
  bar*-"`) returns `200` with a clean (possibly empty) result set — never
  a `500`.
- `GET /api/entries/:id` for an entry belonging to a workspace the caller
  is not a member of returns `404` (the `AGENTS.md` §4 bare-id rule,
  tested explicitly, not just asserted true by inspection).
- `POST /api/v1/ingest` with an unknown token returns `401` and creates no
  rows. With a valid token and an unknown `incident_ref`, creates a new
  incident (`title: "Synced from desktop"`) and the entry in one call.
  Exceeding 60 requests/minute for one *valid* token returns `429`. A test
  proves the *failed-token* limiter is separate: hammering the endpoint
  with 21+ different invalid tokens from one IP within 15 minutes gets
  `429` on the 21st, even though no single token was reused (proving it's
  keyed by IP, not by token) — and a request with a *valid* token from
  that same now-limited IP still gets `429` too (the IP-level lockout
  applies regardless of what the request's token turns out to be, per
  §5.11's "checked before the token lookup runs").
- A test subscriber connected to `GET /api/incidents/:id/stream` receives
  an `entry.created` event when a *different* session creates an entry on
  that same incident (proving the route is actually wired to
  `sse/hub.js`'s `broadcast`, not just accepting connections and doing
  nothing).
- A test subscriber connected to `GET /api/incidents/:id/stream` receives
  the `: heartbeat` comment on the interval `SPEC.md` §6 specifies (25s —
  use a short interval override in the test rather than actually waiting
  25 real seconds, if `sse/hub.js` exposes one; otherwise document in your
  PR how you verified the interval without a 25-second test).
- `GET /api/incidents/:id/stream` for an incident in a workspace the
  caller isn't a member of is rejected by `workspace-guard.js` before any
  SSE headers are sent or any subscription is registered (verified by a
  test asserting `hub.js` never gained a subscriber for that connection).
- Disconnecting a test client from `GET /api/incidents/:id/stream` results
  in the hub's subscriber count for that incident going back to zero
  (proving cleanup on disconnect actually happens and the hub does not
  leak subscribers across requests).
- `npm test` passes, including all new test files, with zero regressions
  in Round 1's existing tests.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output, SPEC.md
sections implemented (§5.4, §5.5, §5.8, §5.10, §5.11, §6, §2.1, §2.5, §9
point 3, §10), what was left out. No UI in this round, so no screenshots
required.

Branch from `main`, open a PR, do not merge.
