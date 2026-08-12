# Devin brief — Round 3b: Desktop v1 sync mode

**Repo:** `schlangens/ir-logger`

Before writing any code, read, in this order: `AGENTS.md`, `SPEC.md`
(especially §2.10), `DESIGN.md` (not directly relevant to this brief, but
read for context), `ROADMAP.md`. This brief does not require any other
round to be merged first to *build* against — `POST /api/v1/ingest`'s
contract is already fully specified in `SPEC.md` §5.11. **But check
before you verify**: if Round 1 and Round 2a are already merged to `main`
when you run this brief, your verification (checklist item 2 below) must
be against a real, running instance of this repo's server — not a stub —
because both halves shipping having only ever spoken to a stand-in of
each other is exactly the integration gap `ROADMAP.md`'s before-launch
checklist calls out. Only if Round 1/2a are genuinely not merged yet may
you verify against a throwaway stub HTTP server instead, and if you do,
say so explicitly in your PR — that makes the real-server check an
outstanding item on `ROADMAP.md`'s before-launch checklist, not a
silently-skipped step.

## What you own (create/edit only these)

```
ir-logger.py
requirements.txt   (only if a genuinely stdlib-uncovered need arises —
                     not expected to change; see AGENTS.md §1)
readme.md          (only the v1 usage-instructions section describing the
                     new "Sync Settings" flow — do not touch the top-of-
                     file v2 pointer note, which already exists)
```

## Do not touch

Anything under `src/` or `public/`, `SPEC.md`, `AGENTS.md`, `DESIGN.md`,
`ROADMAP.md`, `docs/`.

## What to build

Implement `SPEC.md` §2.10 exactly:

1. A new "Sync Settings" button in the existing button row (next to "Save"
   / "Save As") opening a small `tk.Toplevel` dialog with two fields:
   server base URL (e.g. `https://ir.scottslab.io`) and API token. "Save"
   writes `{"server_url": "...", "token": "..."}` to
   `ir-logger-sync.json` in the same directory as `ir-logger.py`. This
   filename is already listed in `.gitignore` — Round 1 added it up front
   specifically so this brief never needs to touch that file (`.gitignore`
   is Round 1's, permanently, per `ROADMAP.md`). Do not edit `.gitignore`
   yourself; if you find `ir-logger-sync.json` isn't actually ignored,
   that's a Round 1 defect to flag in your PR, not something to fix here.
2. On startup, if `ir-logger-sync.json` exists and is valid, load it into
   memory; if it's missing or invalid JSON, sync is simply off (no error
   dialog on startup — this must never block v1's existing offline
   behavior).
3. `log_entry()` (existing method) gains one additional step, **after**
   its existing local file write (never before, never replacing it): if
   sync is configured, build the ingest payload —
   `{"incident_ref": <EventID>, "kind": "technical"|"timeline" (mapped
   from the existing "Technical Details"/"Timestamp Event" radio value),
   "category": <category, only when kind is technical>, "body": <the
   details text>, "occurred_at": <the same timestamp already used for the
   local entry>, "author_name": getpass.getuser()}` — and POST it as JSON
   to `<server_url>/api/v1/ingest` with header `Authorization: Bearer
   <token>` using `urllib.request` (stdlib — no new dependency, per
   `AGENTS.md` §1), with a short timeout (5 seconds) so a slow/unreachable
   server never freezes the UI for long.
4. On a successful POST (`2xx`), update a small status label near the
   Save button to `"Synced ✓ <HH:MM:SS>"`. On any failure (network error,
   non-2xx response, timeout — catch broadly, this must never raise past
   `log_entry()` and never show a blocking `messagebox`), set the label to
   `"Sync failed (saved locally)"`. Either way, the function returns
   normally and the local save that already happened is unaffected —
   sync failure is never visible as an error dialog, only as this passive
   status label, since the local save (the thing that actually matters)
   already succeeded by the time sync is attempted.
5. "Add File" and "Paste Image" remain local-only — do not attempt to sync
   attachments in this brief (explicitly out of scope per `SPEC.md`
   §2.10's last bullet).
6. Update `readme.md`'s existing "Usage Instructions" section to add a
   short "6. Optional: Syncing to the web app" subsection describing the
   Sync Settings dialog, where to get an API token (the web app's
   workspace settings page — reference it by name, not by a URL that
   doesn't exist yet if Round 3a hasn't merged), and that sync is
   best-effort and never required for the tool to work.

## Fail-closed / stances relevant to this brief

- Sync is strictly additive and strictly secondary: the existing local
  file write happens first and is never made conditional on network
  availability, sync configuration, or sync success. v1 must work
  identically to today with `ir-logger-sync.json` absent.
- A sync failure must never surface as a blocking dialog or crash the
  app — only as the passive status label described above. This is the
  opposite of the server-side "fail closed" stances elsewhere in this
  repo: on the desktop client, sync failure fails *open* to "just keep
  working locally," which is the correct behavior here specifically
  because the local file is the analyst's authoritative record and must
  never be blocked by a flaky network — state this distinction plainly in
  your PR description so it isn't mistaken for an inconsistency with
  `AGENTS.md`'s server-side fail-closed rules (those rules govern the
  server; this is the client, and the client's job is to never lose or
  block a local write over a network hiccup).
- The token is stored in a local, git-ignored JSON file, never logged,
  never included in any error dialog text.

## Acceptance criteria — manual verification checklist

v1 has no existing automated test framework and this brief does not
introduce one for a single-file Tkinter script (per `ROADMAP.md`'s Round
3b note). Instead, perform and describe in your PR each of the following:

1. Run `ir-logger.py` with no `ir-logger-sync.json` present: confirm it
   behaves identically to before this change (log an entry, confirm the
   local `.md` file is written, no sync-related errors appear anywhere).
2. Configure Sync Settings with a valid server URL/token pointing at a
   **real, running instance of this repo's server** if Round 1 and Round
   2a are merged (create a real workspace and API token against it,
   through the actual API, per `SPEC.md` §5.3) — only fall back to a
   minimal stub HTTP server you write for this test (not committed) if
   Round 1/2a genuinely aren't merged yet, and say so explicitly in your
   PR if you do. Log an entry, confirm the local file is written **and**
   the status label shows `"Synced ✓ ..."`, **and** confirm the entry
   actually arrived — for the real-server case, by querying the server's
   database (or its `GET /api/incidents/:id/entries` endpoint, if 2a's
   routes are live) and seeing the real, persisted entry with the correct
   `body_md`/category-prefix/provenance-suffix content per §5.11; for the
   stub-only fallback case, via the stub server's request log.
3. Configure Sync Settings with a valid-looking URL that points at
   nothing listening (e.g. an unused port): log an entry, confirm the
   local file is still written correctly and the status label shows
   `"Sync failed (saved locally)"`, with no dialog popup and no delay
   longer than roughly 5 seconds before the UI is responsive again.
4. Confirm "Add File" and "Paste Image" still work exactly as before and
   make no network call.
5. Confirm `ir-logger-sync.json` is listed in `.gitignore` and `git
   status` after saving sync settings does not show it as a trackable
   untracked file needing attention (it should be ignored).

## PR evidence required

Follow `AGENTS.md` §6 as closely as it applies to a Python change: what
changed, the manual verification checklist above with a pass/fail note
per step (in place of `npm test` output — state plainly "no automated
test suite exists for this file; see manual verification checklist"),
screenshots of the Sync Settings dialog and both status-label states
(synced / failed), SPEC.md sections implemented (§2.10), what was left
out (attachment sync, explicitly).

Branch from `main`, open a PR, do not merge.
