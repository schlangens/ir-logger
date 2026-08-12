# Devin brief — Round 2d: Export (PDF + Markdown) + audit route

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`,
`DESIGN.md`, `ROADMAP.md`. Round 1 (foundation) must already be merged to
`main` — branch from `main` after that merge. Your export report needs
incidents/entries/matrix/evidence data; if Round 2a/2b/2c aren't merged
yet, write your own read-only test fixtures (direct `db.prepare(...).run`
inserts in your tests, exactly as Round 2b's brief does) rather than
waiting — you only ever *read* those tables, never their route files.

## What you own (create/edit only these)

```
src/routes/export.js        (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/routes/audit.js         (stub already created + mounted by Round 1 —
                              you fill in its contents only)
src/services/export-pdf.js
src/services/export-markdown.js
src/services/markdown-render.js
tests/export/**
tests/audit-route/**
tests/fixtures/markdown-xss-payloads.js   (new — see item 5 below; Round
                                            3a's frontend brief reads this
                                            same file for its own test,
                                            it never edits it)
```

`src/server.js` already mounts both of your route files at their final
`SPEC.md` §5.9 paths — Round 1 did that. You never add, remove, or touch
a mount line yourself; you only replace each stub router's placeholder
body with real routes.

## Do not touch

`src/server.js` (sole, permanent owner: Round 1 — see `ROADMAP.md`; not
even a one-line mount addition, since Round 1 already mounted your
routers), `src/middleware/**`, `src/services/audit.js` (Round 1 — you
*call* `verify()` from it, you never redefine hashing/verification
logic), `src/services/session-store.js`, `src/uploads/storage.js`,
`src/sse/hub.js`, `src/db/**`, `src/auth/**`, `src/routes/auth.js`,
`src/routes/health.js`, `src/routes/workspaces.js`, `src/routes/demo.js`,
`src/services/demo-seed.js`, `src/services/demo-sweeper.js` (2e),
`src/routes/incidents.js`, `src/routes/entries.js`,
`src/routes/v1-ingest.js`, `src/services/incidents.js`,
`src/services/entries.js`, `src/services/search.js`,
`src/routes/search.js` (2a), `src/routes/techniques.js`,
`src/services/techniques.js`, `src/services/matrix.js` (2b),
`src/routes/evidence.js`, `src/services/evidence.js`,
`src/services/custody.js` (2c), anything under `public/`, `ir-logger.py`.

## What to build

1. `src/services/markdown-render.js` — the server-side implementation of
   the Markdown subset in `SPEC.md` §11, used only for PDF/Markdown
   report layout in this round (the client-side implementation used for
   the live timeline is a separate file owned by Round 3a — do not create
   or edit anything under `public/`). Must HTML-escape input before
   applying any of the subset's transformations (§11's hard XSS
   requirement) even though this output goes into a PDF/plain-text file
   rather than a browser — implement it identically to the spec anyway,
   since `export-markdown.js`'s output is plain Markdown text (no escaping
   needed there) while `export-pdf.js` needs the *parsed structure*
   (paragraphs/bold/italic/code/lists/links) to lay out as PDF text runs,
   not literal HTML — design this module's exported function to return a
   structured token list (not an HTML string) that both `export-pdf.js`
   and `export-markdown.js` can consume, since neither actually wants
   HTML output.
2. `src/services/export-pdf.js` + the PDF route in `src/routes/export.js`
   (`GET /api/incidents/:id/export.pdf`) — generate on the fly with
   pdf-lib, Helvetica/Helvetica-Bold standard fonts (`SPEC.md` §2.6),
   containing: incident metadata, every entry chronologically with
   author/kind/tags, the ATT&CK matrix as a table, and an evidence
   manifest (filename, size, sha256, uploader, time — no file bytes).
   `Content-Type: application/pdf`, `Content-Disposition: attachment`.
   Writes one `audit_log` row (`action='export'`) via Round 1's
   `audit.append()`.
3. `src/services/export-markdown.js` + the Markdown route in
   `src/routes/export.js` (`GET /api/incidents/:id/export.md`) — same
   content as the PDF, rendered as plain Markdown text.
   `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition:
   attachment`. Writes one `audit_log` row (`action='export'`).
4. `src/routes/audit.js` — `GET /api/workspaces/:id/audit` (owner-only,
   paginated, newest-first) and `GET /api/workspaces/:id/audit/verify`
   (owner-only, calls Round 1's `audit.verify()`, returns `200` with
   `{valid, checked, brokenAtId?}` per `SPEC.md` §5.9 — a broken chain is
   itself a successful `200` response, not an error status).
5. `tests/fixtures/markdown-xss-payloads.js` — a small CommonJS module,
   `module.exports = [ { name, input, mustNotContain: [...] }, ... ]`,
   covering at minimum: a raw `<script>alert(1)</script>` tag; a link
   with a `javascript:` scheme; the same `javascript:` payload in mixed
   case (`JavaScript:`) to exercise §11's case-insensitive scheme check;
   the same payload prefixed with a leading space and a control character
   (e.g. a NUL or tab) before the scheme, to exercise §11's
   strip-then-compare rule; a raw `<img src=x onerror=alert(1)>` tag; and
   a raw event-handler attribute on a non-link tag (e.g. `<div
   onclick="alert(1)">`). Each entry's `mustNotContain` lists the literal
   unescaped substring(s) that must never appear in either renderer's
   output for that input. This file is *only* a data fixture — no
   rendering logic lives here, and it must not `require()` either
   renderer (server or client), since Round 3a's `.mjs` test needs to
   import the same array without pulling in any of your CommonJS code.

## Fail-closed stances relevant to this brief

- Workspace/role resolved via `workspace-guard.js` before generating any
  export or returning any audit data — export routes require membership,
  audit routes require `owner` specifically (`analyst`/`viewer` calling
  the audit routes get `403`, since the resource is visible-but-
  forbidden, not cross-tenant-hidden).
- You never write `UPDATE`/`DELETE` against `audit_log` — you only ever
  call Round 1's `audit.append()` (for the export action) and
  `audit.verify()` (read-only) from this brief's files.
- Report generation happens entirely in-memory/on-the-fly per request —
  nothing is cached to disk (no export-file caching layer), so there's no
  additional stored-data surface to secure or clean up.

## Acceptance criteria (testable)

- `GET /api/incidents/:id/export.pdf` for a seeded incident returns `200`
  with `Content-Type: application/pdf`, and the returned bytes start with
  the PDF magic header (`%PDF-`).
- `GET /api/incidents/:id/export.md` for the same incident returns `200`
  with `Content-Type: text/markdown; charset=utf-8`, and the body
  contains the incident's `ref`, every seeded entry's text, and every
  seeded technique tag's id.
- Both export calls each add exactly one `audit_log` row with
  `action='export'` and the correct `target_id`.
- A `node --test` case iterates every entry in
  `tests/fixtures/markdown-xss-payloads.js`, feeds each `input` through
  `markdown-render.js` (and, transitively, through both
  `export-pdf.js`/`export-markdown.js`'s consumption of it), and asserts
  none of that entry's `mustNotContain` strings appear unescaped in the
  Markdown export's body — including the mixed-case and
  leading-whitespace/control-character `javascript:` variants, which
  specifically prove the scheme check normalizes before comparing (§11),
  not just a naive case-sensitive `startsWith`.
- `GET /api/workspaces/:id/audit` as `analyst` or `viewer` returns `403`;
  as `owner` returns `200` with paginated rows.
- `GET /api/workspaces/:id/audit/verify` on a clean chain returns
  `{valid: true}`; on a chain corrupted via a raw, clearly-commented
  test-only `db.exec` (never through `audit.js`) returns `{valid: false,
  brokenAtId: <id>}`, both as `200` responses.
- `npm test` passes, including all new test files, with zero regressions
  in Round 1's (and, if already merged, other Round 2) existing tests.

## PR evidence required

Follow `AGENTS.md` §6: what changed, full `npm test` output, SPEC.md
sections implemented (§2.6, §2.7, §5.9, §11), what was left out. No UI in
this round, so no screenshots required.

Branch from `main`, open a PR, do not merge.
