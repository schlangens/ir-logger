# Devin brief — Round 2c: Evidence + chain of custody

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`,
`DESIGN.md`, `ROADMAP.md`. Round 1 (foundation) must already be merged to
`main` — branch from `main` after that merge.

## What you own (create/edit only these)

```
src/routes/evidence.js      (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/services/evidence.js
src/services/custody.js
tests/evidence/**
tests/custody/**
```

You may create the runtime directory `data/evidence/` at server boot if it
doesn't exist (this directory is not committed — confirm it's covered by
Round 1's `.gitignore` additions; if it isn't, that is the one exception
where you should flag it in your PR rather than editing `.gitignore`
yourself, since `.gitignore` belongs to Round 1). `src/server.js` already
mounts `src/routes/evidence.js` at its final `SPEC.md` §5.7 paths — Round
1 did that. You never add, remove, or touch a mount line yourself, and
you never configure `multer.diskStorage` yourself either — Round 1 owns
that configuration in `src/uploads/storage.js`; you `require()` it and use
it inside `src/routes/evidence.js` only.

## Do not touch

`src/server.js` (sole, permanent owner: Round 1 — see `ROADMAP.md`; not
even a one-line mount addition, since Round 1 already mounted your
router), `src/uploads/storage.js` (Round 1 — import the configured multer
instance, never redefine or reconfigure the disk-storage engine yourself),
`src/middleware/**`, `src/services/audit.js`, `src/services/session-
store.js`, `src/sse/hub.js`, `src/db/**`, `src/auth/**`,
`src/routes/auth.js`, `src/routes/health.js`, `src/routes/workspaces.js`,
`src/routes/demo.js`, `src/services/demo-seed.js`,
`src/services/demo-sweeper.js` (2e), `src/routes/incidents.js`,
`src/routes/entries.js`, `src/routes/v1-ingest.js`,
`src/services/incidents.js`, `src/services/entries.js`,
`src/services/search.js`, `src/routes/search.js` (2a),
`src/routes/techniques.js`, `src/services/techniques.js`,
`src/services/matrix.js` (2b), `src/routes/export.js`,
`src/routes/audit.js`, `src/services/export-*.js`,
`src/services/markdown-render.js` (2d), anything under `public/`,
`ir-logger.py`.

## What to build

Implement `SPEC.md` §5.7 and §7 exactly:

1. `POST /api/incidents/:id/evidence` — `multipart/form-data`, field
   `file`, optional field `entry_id`, using the multer instance imported
   from Round 1's `src/uploads/storage.js` (do not call
   `multer.diskStorage(...)` yourself anywhere in this brief — the
   storage engine/destination/filename-generation is already configured
   there; this route only adds the per-request size/count/total-byte cap
   checks, which are your responsibility, not Round 1's). Resolve the
   incident's workspace via `workspace-guard.js` first (owner|analyst
   only). **Before accepting any
   bytes**, check the workspace's evidence caps: per-file size limit (25MB
   normal / 5MB if `workspaces.is_demo=1` — enforce via multer's
   `limits.fileSize` set dynamically per request, or a pre-check plus a
   streamed abort, your choice, but it must reject before writing a
   partial oversized file to disk permanently — clean up any partial file
   on rejection), workspace evidence-row-count cap (5 for demo, checked
   before accepting the upload — `409` if already at cap), and
   workspace evidence-total-bytes cap (200MB normal / 20MB demo, checked
   before accepting — `409` if the new file would exceed it). Stream the
   upload to `data/evidence/<24-char nanoid>.bin` while computing
   `sha256` in the same pass (`crypto.createHash('sha256')` piped
   alongside the write stream — not a second read-back, per `SPEC.md`
   §7). Sanitize the display `filename` per §7's exact character-class
   rule. Insert the `evidence` row + a `custody_events` row
   (`action='uploaded'`) **and** an `audit_log` row
   (`action='evidence.uploaded'`, `target_type='evidence'`, via Round 1's
   `audit.append()`) in one transaction, broadcast `evidence.uploaded` via
   Round 1's `sse/hub.js`.
2. `GET /api/incidents/:id/evidence` — list, metadata only, no
   `stored_path` in the response.
3. `GET /api/evidence/:id` — metadata only. **Bare-id route** (no
   incident/workspace segment in its path) — resolve tenant scope via
   `evidence.incident_id → incidents.workspace_id → workspace-guard.js`,
   exactly the pattern `SPEC.md` §5.5 spells out for entries and §5.7
   restates for evidence; never trust a workspace id from the request.
   Writes a `custody_events` row (`action='viewed'`) **and** an
   `audit_log` row (`action='evidence.viewed'`, `target_type='evidence'`,
   via Round 1's `audit.append()`) — see the correction in `SPEC.md` §2.3:
   evidence access history needs the same tamper-evidence as everything
   else, so it is never written to `custody_events` alone.
4. `GET /api/evidence/:id/download` — same bare-id tenant-scoping as
   above. Streams the file from `stored_path`. Response headers
   **always** `Content-Type: application/octet-stream` and
   `Content-Disposition: attachment; filename="<sanitized display
   filename>"` — never the original `mime`, regardless of what was
   recorded at upload (`SPEC.md` §7, non-negotiable). Writes a
   `custody_events` row (`action='downloaded'`) **and** an `audit_log`
   row (`action='evidence.downloaded'`) via `audit.append()`.
5. `GET /api/evidence/:id/custody` — same bare-id tenant-scoping as
   above. The full custody trail for one evidence item, chronological
   oldest-first.
6. `src/services/custody.js` — the shared helper Round 2's evidence route
   uses to append a `custody_events` row **and, in the same call, an
   `audit_log` row via Round 1's `audit.append()`** (used by both the
   automatic upload/view/download logging above, kept as its own module
   since `SPEC.md`/`AGENTS.md` describe custody-trail logic as a distinct
   concern from evidence CRUD). `custody_events` is append-only exactly
   like `audit_log` (`AGENTS.md` §4): no `UPDATE`/`DELETE` against it
   anywhere in this file or anywhere else you touch.

## Fail-closed stances relevant to this brief

- Workspace/role resolved via `workspace-guard.js` before any upload,
  read, or download — a request for evidence belonging to an incident in
  a workspace the caller isn't a member of returns `404`.
- Size/count/total-byte caps are checked **before** any file bytes are
  written to disk, not after (a rejected upload must leave zero trace on
  disk — clean up any partial write if a streaming check fails partway
  through).
- The `Content-Type: application/octet-stream` / `Content-Disposition:
  attachment` pair on downloads is not configurable and not skippable for
  any file type, including ones that "look safe" (e.g. `.txt`, `.png`) —
  there is no allowlist of types served inline. This is a hard security
  requirement, not a default that a future flag could relax.
- `custody_events` is append-only, same rule and same grep check as
  `audit_log` (`AGENTS.md` §4) — no `UPDATE`/`DELETE` against it anywhere.
  Every custody event (`uploaded`/`viewed`/`downloaded`) is also written
  to `audit_log` in the same transaction — one without the other is a bug.

## Acceptance criteria (testable)

- Uploading a file under all caps succeeds, and the computed `sha256`
  matches an independently-computed hash of the same bytes (test uploads
  a fixture file with a known hash and asserts equality).
- Uploading a file over the per-file size cap is rejected and no file is
  left on disk afterward (test asserts the `data/evidence/` directory has
  no new file, or that a partial file was cleaned up).
- Uploading a 6th evidence item to a demo workspace (`is_demo=1`, already
  at 5 rows) returns `409` and creates no row.
- `GET /api/evidence/:id/download` response headers are
  `Content-Type: application/octet-stream` even when the uploaded file's
  declared `mime` was `image/png` or `text/html` — verified by a test
  that uploads a file with an `image/png` field value and asserts the
  download response's `Content-Type` header is `application/octet-stream`,
  not `image/png`.
- A filename containing path separators or control characters (e.g.
  `../../etc/passwd`) is sanitized per §7's rule before being used in
  `Content-Disposition`, and is never used to construct the on-disk path
  (the on-disk path is always the generated nanoid, verified by a test
  that asserts `stored_path` never contains the original filename
  substring).
- `GET /api/evidence/:id` and `GET /api/evidence/:id/download` each add
  exactly one `custody_events` row **and exactly one `audit_log` row** of
  the corresponding `action`, and `GET /api/evidence/:id/custody` returns
  the custody rows in chronological order.
- A request for evidence in a workspace the caller isn't a member of
  returns `404` for all four evidence routes (the `AGENTS.md` §4 bare-id
  rule) — each of the three bare-id routes (`GET /api/evidence/:id`,
  `/download`, `/custody`) gets its own explicit test for this, not one
  shared assertion standing in for all three.
- `npm test` passes, including all new test files, with zero regressions
  in Round 1's (and, if already merged, other Round 2) existing tests.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output, SPEC.md
sections implemented (§2.3, §5.7, §7, §8.4), what was left out. No UI in
this round, so no screenshots required.

Branch from `main`, open a PR, do not merge.
