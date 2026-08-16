# Incident Logger v2 — Specification

Repo: `schlangens/ir-logger`. This document is the single source of truth for
product behavior and technical contract. It is decision-complete: where the
handed-down architecture left a choice open, this document makes the choice
and states it plainly (see "Decisions made in this document" at the end of
each relevant section, or inline as "Decision:"). No section of this document
should be read as "TBD" or "up for discussion" by an implementing agent.

Companion documents: `AGENTS.md` (rules for coding agents), `DESIGN.md`
(visual system), `ROADMAP.md` (build order), `docs/devin-briefs/*.md`
(per-session prompts).

---

## 1. What v1 was, and why v2 exists

`ir-logger.py` is a single-file Python/Tkinter desktop application. An analyst
runs it locally. It has:

- An `EventID` field and a read-only dropdown of past event IDs, discovered by
  scanning the current working directory for `Incident_<id>/` folders or
  `<id>.md` files.
- A choice between "Technical Details" (filed under a category: Initial
  Access, Execution, Persistence, Scheduled Tasks, Privilege Escalation,
  Defense Evasion, Credential Access, Discovery, Lateral Movement, Command and
  Control, Exfiltration) and "Timeline Event" (no category).
- A free-text details box, appended as a Markdown bullet under a `##
  <Category>` heading in `Incident_<EventID>/Event_Report.md`, or to a
  standalone file chosen with "Save As".
- "Add File", which copies a file into the incident folder and inserts a
  `[Attached File: ...]` line into the correct category section.
- "Paste Image", which grabs an image from the OS clipboard (via Pillow) and
  saves it into the incident folder, inserting a reference into the details
  box.
- A read-only preview pane showing the raw Markdown of the current report.

Everything is local files on one analyst's machine: no accounts, no sharing,
no history beyond what's on disk, no way for a second analyst to see entries
as they're added, no structured technique tagging, no evidence integrity
(hashing, chain of custody), and no export beyond the raw Markdown file
itself.

v2 is a hosted, multi-analyst web application that keeps everything v1 was
good at (fast, low-friction entry logging) and adds what a real incident
response team needs: live shared timelines, MITRE ATT&CK technique tagging
with a coverage matrix, hashed evidence with chain of custody, a
severity/status workflow, full-text search, polished report export, and a
tamper-evident audit trail. v1 keeps working standalone and gains an optional
mode to sync into v2.

---

## 2. Scoped capabilities

### 2.1 Live incident timeline

Every incident has a timeline of entries (technical findings, timeline
events, and free-form notes — see the `entries.kind` column in §4). When any
analyst with access to the incident adds an entry, every other browser tab
currently viewing that incident's timeline receives it within one second via
Server-Sent Events (§6), with no page reload and no polling. The timeline is
ordered by `occurred_at` (the time the analyst says the event happened, which
may be back-dated), with `created_at` shown as a secondary "logged at"
timestamp when the two differ by more than five minutes.

Entries are immutable once created: there is no edit or delete for a
published entry. Decision: this matches the tamper-evident spirit of the
audit log and avoids a whole class of "what did it say before" ambiguity in
an IR record. If an analyst makes a mistake, the convention (documented in
the UI's entry composer placeholder text) is to add a correcting entry, not
alter history. Incident-level fields (title, summary, severity, status) are
mutable — see §2.4 — and every change to them is recorded in the audit log.

### 2.2 MITRE ATT&CK technique tagging + coverage matrix

When composing a `technical` entry, an analyst can attach zero or more MITRE
ATT&CK Enterprise techniques from a searchable picker (search by ID or name).
Tags are stored in `entry_techniques` (§4). Each incident has a coverage
matrix view: one column per tactic (in the fixed order given in §2.2.1),
technique cells inside each tactic's column, and heat (visual weight) driven
by how many tagged entries reference that technique in this incident. Cells
with zero entries are visibly present but visually recessed (see
`DESIGN.md` for the exact cell states) — the matrix always shows the full
seeded technique set, not just the ones used, so a reviewer can see coverage
gaps at a glance.

#### 2.2.1 Seeded technique reference data

Decision: v2 seeds a curated subset of MITRE ATT&CK Enterprise techniques —
not the full ~600-entry corpus — because the full corpus is unnecessary
weight for a v2 build and can be extended later without a schema change (the
table is generic `id, name, tactic, url`). The seed set below covers the 14
Enterprise tactics with 3–5 representative techniques each, including
frequently-cited sub-techniques, sourced from MITRE's public ATT&CK
Enterprise matrix (Apache-2.0 licensed data; the seed script cites the
source URL pattern `https://attack.mitre.org/techniques/<ID>/`, with dots in
sub-technique IDs replaced by `/` in the URL, e.g. `T1566.001` →
`.../techniques/T1566/001/`).

Fixed tactic order (this is also the fixed column order of the coverage
matrix):

1. Reconnaissance
2. Resource Development
3. Initial Access
4. Execution
5. Persistence
6. Privilege Escalation
7. Defense Evasion
8. Credential Access
9. Discovery
10. Lateral Movement
11. Collection
12. Command and Control
13. Exfiltration
14. Impact

Seed rows (`id, name, tactic`):

```
T1595, Active Scanning, Reconnaissance
T1589, Gather Victim Identity Information, Reconnaissance
T1598, Phishing for Information, Reconnaissance
T1583, Acquire Infrastructure, Resource Development
T1586, Compromise Accounts, Resource Development
T1587, Develop Capabilities, Resource Development
T1566, Phishing, Initial Access
T1566.001, Spearphishing Attachment, Initial Access
T1566.002, Spearphishing Link, Initial Access
T1190, Exploit Public-Facing Application, Initial Access
T1078, Valid Accounts, Initial Access
T1059, Command and Scripting Interpreter, Execution
T1059.001, PowerShell, Execution
T1204, User Execution, Execution
T1204.002, Malicious File, Execution
T1053, Scheduled Task/Job, Persistence
T1053.005, Scheduled Task, Persistence
T1547, Boot or Logon Autostart Execution, Persistence
T1136, Create Account, Persistence
T1078.004, Valid Accounts: Cloud Accounts, Privilege Escalation
T1055, Process Injection, Privilege Escalation
T1068, Exploitation for Privilege Escalation, Privilege Escalation
T1027, Obfuscated Files or Information, Defense Evasion
T1070, Indicator Removal, Defense Evasion
T1070.004, File Deletion, Defense Evasion
T1562, Impair Defenses, Defense Evasion
T1003, OS Credential Dumping, Credential Access
T1003.001, LSASS Memory, Credential Access
T1110, Brute Force, Credential Access
T1552, Unsecured Credentials, Credential Access
T1082, System Information Discovery, Discovery
T1087, Account Discovery, Discovery
T1018, Remote System Discovery, Discovery
T1021, Remote Services, Lateral Movement
T1021.001, Remote Desktop Protocol, Lateral Movement
T1021.002, SMB/Windows Admin Shares, Lateral Movement
T1550, Use Alternate Authentication Material, Lateral Movement
T1560, Archive Collected Data, Collection
T1074, Data Staged, Collection
T1074.001, Local Data Staging, Collection
T1071, Application Layer Protocol, Command and Control
T1071.001, Web Protocols, Command and Control
T1105, Ingress Tool Transfer, Command and Control
T1572, Protocol Tunneling, Command and Control
T1041, Exfiltration Over C2 Channel, Exfiltration
T1567, Exfiltration Over Web Service, Exfiltration
T1029, Scheduled Transfer, Exfiltration
T1486, Data Encrypted for Impact, Impact
T1490, Inhibit System Recovery, Impact
T1489, Service Stop, Impact
```

Each row's `url` is generated by the seed script from the pattern above.
This seed set is inserted idempotently (by primary key) during the Round 1
migration; re-running migrations must not duplicate or error on rows that
already exist (`INSERT OR IGNORE`).

### 2.3 Evidence with hashing + chain of custody

An analyst can upload a file to an incident (optionally attached to a
specific entry). On ingest, the server streams the upload to disk while
computing its SHA-256 digest, and records `filename` (the sanitized original
name, display-only), `mime` (the client-declared type, display-only, never
trusted for serving — see §7), `size`, `sha256`, and `stored_path` (a
generated id, never the original filename — see §7). A `custody_events` row
with `action='uploaded'` is written in the same transaction as the evidence
row. Every subsequent view of evidence metadata, download of the file, logs
a further `custody_events` row (`viewed`, `downloaded`) — see §5.6 for
exactly which endpoints log which action. Each evidence item's detail view
shows its full custody trail as an ordered, append-only list: who did what,
when.

Correction to an earlier draft of this document: `custody_events` alone is
**not** tamper-evident — it has no hash chain of its own, and calling it
"append-only" in prose without an enforced rule is meaningless. Evidence
access history (who viewed or downloaded a piece of evidence, and when) is
the single most forensically important fact in a chain of custody, so it
gets the same protection as everything else in this app: every
`custody_events` insert (`uploaded`, `viewed`, `downloaded`, and — if ever
used — `exported`) is also appended to `audit_log` via the same
`audit.append()` helper described in §2.7 (`action` values
`evidence.uploaded` / `evidence.viewed` / `evidence.downloaded` /
`evidence.exported`, `target_type='evidence'`), in the same transaction as
the `custody_events` row. `custody_events` itself is also, independently,
append-only: no code path anywhere in the server issues `UPDATE` or
`DELETE` against it, mirroring the `audit_log` rule in `AGENTS.md`
exactly (same grep check, same requirement). The `exported` custody action
exists in the schema for a future evidence-bundle export feature; this v2
build's report export (§2.6) embeds evidence *metadata and hashes only*,
never raw file bytes, so `exported` is never written by this build — this
is a deliberate scope boundary, not an oversight.

### 2.4 Severity + status workflow

Every incident has `severity` (`low`, `medium`, `high`, `critical`) and
`status` (`open`, `contained`, `eradicated`, `recovered`, `closed`).
Severity can be changed freely by an owner or analyst at any time. Status
transitions:

- `open`, `contained`, `eradicated`, `recovered` are freely interchangeable
  by an owner or analyst (an incident's remediation stage is not always
  linear — an analyst may need to move it backward, e.g. `recovered` →
  `contained` if a new artifact surfaces).
- Moving a `status` to `closed`, and moving a `status` *out of* `closed`
  (reopening), are owner-only actions. Decision: closing/reopening is a
  workflow-ending/workflow-restarting decision with reporting consequences,
  so it is gated one level higher than day-to-day status movement.
- `closed_at` is set to the current time when `status` becomes `closed`, and
  cleared (`NULL`) when reopened.
- Every status or severity change writes an `audit_log` row
  (`action='incident.updated'`) with the before/after values in
  `payload_json`.

### 2.5 Full-text search

`GET /api/workspaces/:id/search?q=` searches `entries.body_md` across every
incident in the caller's workspace using SQLite FTS5 (`entries_fts`, kept in
sync by triggers — see §4). Results are grouped by incident, each showing an
FTS5 `snippet()` excerpt with the match highlighted, ordered by FTS5's `bm25`
relevance rank. Search is workspace-scoped through the same incident →
workspace join the workspace guard uses elsewhere (§8.2) — there is no path
that returns entries from another workspace.

### 2.6 Report export (PDF + Markdown)

`GET /api/incidents/:id/export.pdf` and `GET /api/incidents/:id/export.md`
generate a report on the fly (nothing is cached or stored) containing:
incident ref/title/summary/severity/status/opened/closed, every timeline
entry in chronological order with its author, kind, and tagged techniques,
the ATT&CK coverage matrix as a table, and an evidence manifest (filename,
size, SHA-256, uploader, upload time — no file bytes). Both exports write one
`audit_log` row (`action='export'`, `target_type='incident'`). The PDF uses
pdf-lib's built-in Helvetica/Helvetica-Bold standard fonts (Decision: no
custom font embedding for the PDF — the web app's self-hosted fonts, §DESIGN,
are a separate concern from PDF font embedding, and pdf-lib's standard fonts
render correctly with zero extra assets). The Markdown export is the same
content rendered as plain Markdown text, `Content-Type:
text/markdown; charset=utf-8`.

### 2.7 Tamper-evident audit trail

`audit_log` is append-only: no code path anywhere in the server issues
`UPDATE` or `DELETE` against it. Every row is hash-chained *per workspace*:

```
hash = sha256(prev_hash || canonical_json({
  id, workspace_id, actor_user_id, action, target_type, target_id, at, payload_json, prev_hash
}))
```

`canonical_json` = `JSON.stringify` of the object with keys in the fixed
order shown above (not alphabetical — insertion order as written, so the
algorithm is a fixed, reproducible byte sequence). The first row for a given
`workspace_id` uses `prev_hash = '0'.repeat(64)` (genesis). Chain order
within a workspace is the table's SQLite `rowid` insertion order (append-only
tables have monotonically increasing `rowid`; this is exposed via `ORDER BY
rowid`, never via `at`, since two events in the same millisecond would make
`at` an unreliable tiebreaker).

`GET /api/workspaces/:id/audit/verify` (owner-only) walks a workspace's chain
in `rowid` order, recomputing each row's hash from its stored fields and
comparing to the stored `hash`, and checking each row's `prev_hash` equals
the previous row's stored `hash`. It returns the first row where either check
fails, or confirms the whole chain is intact.

**Honest scope of this guarantee** (stated plainly because the algorithm
above is fully published in this document, so an expert reader can and
should check the claim): this detects tampering through any path that
does *not* have direct write access to the SQLite file — a compromised
session, a bug in the app's own write paths, a bad migration, anything
going through normal application access. It does **not** detect tampering
by someone who already has direct database write access (e.g. shell
access to the box) *and* takes the extra step of recomputing the chain
forward after editing a row — with the algorithm public, that person can
edit a row and rewrite every subsequent `hash`/`prev_hash` so `verify()`
reports the chain intact. Closing that gap requires anchoring the chain
somewhere the same privileged actor can't also rewrite — periodically
signing the latest hash with a key stored outside the database, writing
to WORM (write-once) storage, or forwarding each row to an external,
independently-operated log sink. All three are deliberately out of scope
for v2 (see §3 Non-goals) — this build's guarantee is "tamper-evident
against everything except a privileged actor who also updates the
chain," not "tamper-proof," and the product should never claim otherwise.

### 2.8 Instant sandbox demo

See §9 (Demo sandbox lifecycle) for the full lifecycle. In short: an
anonymous visitor clicks "Try the live demo" on the landing page, the server
creates a `workspaces` row with `is_demo=1` and `expires_at = now + 24h`,
seeds one realistic incident (phishing → credential access → lateral
movement, with tagged techniques and one fake evidence file), and drops the
visitor straight into that workspace with a demo session — no registration,
no email, no password. A sweeper deletes expired demo workspaces (including
their evidence files on disk) on an interval. Demo workspace creation is
rate-limited per IP, and demo workspaces have hard caps on uploads and
incident count (§9).

### 2.9 Real accounts

Email+password (bcrypt, cost factor 12) and Google OAuth accounts. A
registered user's first action is to create a workspace (becoming its
`owner`) or accept an invite to an existing one. Roles: `owner` (full
control including inviting/removing members, closing/reopening incidents,
reading the audit log), `analyst` (create/update incidents, add entries,
upload evidence, tag techniques — everything except owner-only actions),
`viewer` (read-only across the whole workspace: timeline, matrix, evidence
metadata and download, search, exports — but no writes).

Decision: invite delivery is link-based, not emailed. `POST
/api/workspaces/:id/invite` creates an `invites` row and returns an
acceptance URL (`/invite/:token`) for the owner to copy and send however
they choose (Slack, email client, in person). No outbound email is sent by
the app. This keeps the fixed dependency list free of an email provider and
matches the "never send email" operating rule for this build (`AGENTS.md`)
— it is a real, permanent product decision, not just a dev-time
restriction: v2 does not send transactional email at all, including for
password reset (there is no password-reset flow in this build — see §11
Non-goals).

**Closing public registration (`REGISTRATION_OPEN`)**: `POST
/api/auth/register` is gated by the `REGISTRATION_OPEN` environment
variable — open by default (unset, or anything other than the literal
string `"false"`), so a zero-configuration clone always gets a working
sign-up. The live deployment sets it to `"false"` once it has real users,
so a stranger can no longer create an account there; existing accounts
(password or Google) still log in normally, and the login/register pages
hide the sign-up affordance rather than offer one that would fail (§5.2).
Closing registration must not strand a workspace owner: because accepting
an invite (`POST /api/invites/:token/accept`, above) requires an existing
session whose account email matches the invite exactly, a brand-new
invitee would otherwise have no way to get that account. `POST
/api/auth/register` therefore also accepts an optional `invite_token`
field and lets that one registration through, regardless of
`REGISTRATION_OPEN`, if it matches a pending, unexpired, unaccepted
invite for the email being registered (§5.2).

### 2.10 Desktop v1 sync

`ir-logger.py` continues to work fully offline with zero server dependency —
nothing in this section may make the server a requirement for v1's existing
behavior. It gains an optional, opt-in sync mode:

- A new "Sync Settings" button opens a small dialog to enter a server base
  URL and an API token (obtained from the web app's workspace settings page,
  §5.9). These are saved to `ir-logger-sync.json` next to `ir-logger.py`
  (git-ignored) so they persist between runs.
- When sync is configured, `log_entry()` additionally attempts `POST
  /api/v1/ingest` (§5.10) with the same data just appended locally. Decision:
  use Python's built-in `urllib.request` for this, not the `requests`
  library — Node's dependency-discipline rule ("no new dependency without
  justification") is applied to the Python tool too, and `urllib` covers a
  single JSON POST with a bearer header without a third-party package.
  `requirements.txt` is unchanged.
  - On success, a small "Synced ✓" status label near the Save button updates
    with a timestamp.
  - On failure (no network, bad token, server down), the failure is caught,
    a status label shows "Sync failed (saved locally)" in place, and the
    local file save that already happened is unaffected. Sync is always
    best-effort and always secondary to the local file write, which happens
    first, unconditionally, exactly as in v1 today.
- "Add File" and "Paste Image" remain local-only in this version (the
  ingest endpoint in §5.10 is text-entry only); attachments are not synced.
  This is a stated scope boundary, not a bug.

---

## 3. Non-goals

- No multi-organization billing (a workspace is the only tenancy boundary;
  no plans, seats, or payment processing).
- No SIEM/EDR/ticketing integrations (no Splunk, no Sentinel, no Jira, no
  webhooks out).
- No mobile app.
- No AI features (no summarization, no suggested tags, no chat).
- No outbound transactional email of any kind (invites and, if ever added,
  password reset are link-based/manual — see §2.9).
- No password-reset flow in this build (an owner with direct database
  access can clear a `password_hash` to force a re-registration path if
  ever needed operationally; there is no in-app self-service flow).
- No editing or deleting of published entries or audit log rows (§2.1,
  §2.7).
- No in-browser preview/rendering of evidence file contents — evidence is
  metadata + hash + download only, matching the "never served with its
  original content-type" stance (§7).
- No full 600+ technique MITRE corpus — a curated seed subset (§2.2.1).
- No real-time collaborative *editing* (no cursors, no locking) — SSE is
  one-directional broadcast of new entries/state changes only, not a CRDT
  or operational-transform system.
- No externally-anchored tamper-evidence for the audit/custody hash chain
  (no periodic signing with an offline key, no WORM storage, no forwarding
  to an independent external log sink). §2.7 states plainly what the
  in-database hash chain does and does not protect against; closing that
  remaining gap is explicitly deferred, not an oversight.

**Deliberately deferred to a future version (not oversights):**

- Structured indicator extraction as its own field type (today, IOCs like
  IPs/hashes/domains live inside free-text `body_md`, not a queryable
  structured column).
- @-mentions and assignment (routing a specific entry or incident to a
  specific analyst).
- Notifications beyond the live in-app feed (no email/SMS/push alerts —
  consistent with §2.9's no-outbound-email decision).
- Curated executive-summary exports (today's export is the full technical
  timeline + matrix + evidence manifest; a shorter, audience-tailored
  summary report is a v3 feature).

---

## 4. Data model (SQL DDL)

Three tables beyond the handed-down model are added because they are
necessary to implement it without adding a new dependency: `sessions` (a
SQLite-backed `express-session` store, replacing the default in-memory
store so login survives a `pm2 restart`, using the already-installed
`better-sqlite3` rather than adding a `connect-sqlite3` dependency),
`rate_limits` (a generic SQLite-backed fixed-window counter used by every
rate-limited endpoint in this spec, for the same no-new-dependency reason),
and `invites` (required to implement §2.9's link-based invite flow). A
`schema_migrations` table tracks which numbered migration files have run.

```sql
-- 001_init.sql

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  google_id TEXT UNIQUE,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL OR is_demo = 1)
);

CREATE TABLE memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL CHECK (role IN ('owner','analyst','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, workspace_id)
);
CREATE INDEX idx_memberships_workspace ON memberships(workspace_id);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('open','contained','eradicated','recovered','closed')) DEFAULT 'open',
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE (workspace_id, ref)
);
CREATE INDEX idx_incidents_workspace ON incidents(workspace_id);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  kind TEXT NOT NULL CHECK (kind IN ('technical','timeline','note')),
  occurred_at TEXT NOT NULL,
  body_md TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_entries_incident ON entries(incident_id, created_at);

CREATE TABLE techniques (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tactic TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE entry_techniques (
  entry_id TEXT NOT NULL REFERENCES entries(id),
  technique_id TEXT NOT NULL REFERENCES techniques(id),
  PRIMARY KEY (entry_id, technique_id)
);
CREATE INDEX idx_entry_techniques_technique ON entry_techniques(technique_id);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  entry_id TEXT REFERENCES entries(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_evidence_incident ON evidence(incident_id);

CREATE TABLE custody_events (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  action TEXT NOT NULL CHECK (action IN ('uploaded','viewed','downloaded','exported')),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  note TEXT
);
CREATE INDEX idx_custody_evidence ON custody_events(evidence_id, at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_audit_workspace ON audit_log(workspace_id);
-- No UPDATE or DELETE statement against audit_log may exist anywhere in the codebase.

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT
);

-- FTS5 external-content index over entries.body_md, synced by triggers.
CREATE VIRTUAL TABLE entries_fts USING fts5(
  body_md, content='entries', content_rowid='rowid'
);

CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, body_md) VALUES (new.rowid, new.body_md);
END;
CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, body_md) VALUES ('delete', old.rowid, old.body_md);
END;
CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, body_md) VALUES ('delete', old.rowid, old.body_md);
  INSERT INTO entries_fts(rowid, body_md) VALUES (new.rowid, new.body_md);
END;
-- The app never issues UPDATE/DELETE on entries (§2.1); these triggers exist
-- for defense-in-depth so the index can never silently drift from the table.

-- Implementation-necessary additions (not part of the handed-down model,
-- added to avoid a new dependency — see the note above this DDL block):

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  session_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE rate_limits (
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','analyst','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT
);
CREATE INDEX idx_invites_workspace ON invites(workspace_id);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

Migration mechanics: numbered files `src/db/migrations/NNN_description.sql`
are applied in order at server boot, each wrapped in a transaction, each
recorded in `schema_migrations` by `version` (the leading number). The
technique seed data (§2.2.1) ships as `002_seed_techniques.sql` using
`INSERT OR IGNORE`, so re-running it is a no-op.

ID format: every `TEXT PRIMARY KEY` id in this schema is a 16-character
`nanoid()` (default nanoid alphabet), generated in application code, except
`api_tokens.id` (16-character nanoid) and the raw bearer token handed to the
user (32-character nanoid, shown exactly once at creation time, never
stored — only `token_hash = sha256(rawToken)` is stored, hex-encoded).

---

## 5. HTTP API surface

Conventions used throughout this section:

- All request/response bodies are JSON unless noted (file upload and file
  download endpoints use `multipart/form-data` and raw binary streams
  respectively).
- All timestamps are ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Error responses are always `{ "error": "<message>" }` with one of these
  status codes: `400` invalid input, `401` no/invalid session or token,
  `403` authenticated but not permitted for this specific action, `404`
  not found *or* not visible to the caller's workspace (see the rule
  below), `409` conflict (e.g. a workspace resource cap reached), `429`
  rate-limited (with a `Retry-After` header, seconds), `503` a fail-closed
  rate-limiter or demo-capacity guard could not evaluate (the workspace
  guard's own storage error is `403`, see §8.2).
- **Cross-tenant existence rule**: a request for a workspace-scoped resource
  (incident, entry, evidence, etc.) that exists but belongs to a workspace
  the caller is not a member of returns `404`, identical to the resource
  not existing at all. `403` is reserved for cases where the resource *is*
  visible in the caller's own workspace but their role doesn't permit the
  specific action (e.g. a `viewer` calling a POST/PATCH/DELETE route).
- "Auth: session" means an authenticated `express-session` (real user or
  demo session, §9). "Auth: session (owner)" / "(owner\|analyst)" further
  restricts by the caller's `memberships.role` for the workspace the
  resource belongs to. "Auth: token" means a `Authorization: Bearer
  <token>` header validated against `api_tokens.token_hash`.

### Response field naming — Decision

**All JSON response bodies use `snake_case` field names.** A response field
name is always either the literal underlying database column name (§4) or,
for a computed/joined field, a plain `snake_case` compound name in the same
style (`entry_count`, `last_activity_at`, `author_name`). This governs
responses only — it does not change any request body's field names.

This was not always true as shipped: incident and entry responses
(§5.4–§5.5) were written as raw database rows, which are naturally
`snake_case`, while evidence, custody, and search responses (§5.6–§5.8)
were hand-mapped to `camelCase` by their own service functions, and the
audit-verify, demo, workspace-invite/token, health, and v1-ingest
responses picked up the same `camelCase` habit independently. No single
round did this "wrong" — earlier drafts of this document were themselves
inconsistent on the point — but left alone it becomes a permanent split
the moment a frontend hard-codes both shapes.

**The count behind this decision** (counted directly against
`src/routes/*.js` and the service functions that build each response,
not guessed): weighing endpoints by how many multi-word response fields
they actually carry — the metric that best reflects real API surface,
since a bare endpoint count treats a two-field response the same as a
seven-field one — `snake_case` accounts for 51 response-field occurrences
across 8 endpoints (the incidents endpoints of §5.4, the entries endpoints
of §5.5, and the raw `audit_log` rows of §5.9's list route), versus 28
`camelCase` response-field occurrences spread across 12 smaller endpoints
(evidence, custody, search, demo, workspace invite/tokens, audit/verify,
health, and v1-ingest). By distinct field *name* count it is closer (20
distinct `snake_case` names vs. 16 distinct `camelCase` names), and by raw
endpoint count `camelCase` is actually slightly ahead (12 vs. 8) — the
picture is genuinely mixed by every metric except the field-occurrence
count, which is why cost-to-change is the deciding factor, not a close
count alone. `GET /api/workspaces/:id` is the one response that is
internally mixed today (the workspace object's own fields — `is_demo`,
`expires_at`, `created_at` — are `snake_case`; its nested `members[].userId`
is `camelCase`) — the concrete case of "SPEC.md is itself mixed" made
visible in running code.

**Cost to change** breaks the tie decisively toward `snake_case`: the
incidents and entries endpoints are the two highest-traffic, most
pervasively consumed resources in the app (rendered on nearly every page,
broadcast over SSE, read by PDF/Markdown export) and are raw database rows
with *no* mapping layer at all today — making them `camelCase` would mean
adding a new mapping layer to the app's most central, most heavily-tested
code paths for no functional gain. The `camelCase` endpoints, by contrast,
are already produced by small, isolated, hand-written mapping functions
(`services/evidence.js`'s `metadata()`, `services/custody.js`'s `list()`,
`services/search.js`'s `search()` result mapper) or a handful of one-line
response-object literals (`routes/demo.js`, `routes/workspaces.js`,
`routes/audit.js`, `routes/health.js`, `routes/v1-ingest.js`) — renaming
the keys those functions already build is a small, mechanical, low-risk
change confined to about a dozen call sites, not a new abstraction over
core data.

**`payload_json` on the audit endpoints (§5.9) is a parsed JSON object in
the response, never a JSON-encoded string.** The server already validates
it as `JSON.stringify`-produced output at write time
(`services/audit.js`'s `append()`), so the value is always well-formed
JSON by construction; returning it pre-parsed removes a defensive
`JSON.parse()` (and the failure handling that call would otherwise need)
from every consumer, for zero loss of information and zero added risk.
This is a value-type fix, not a key-naming one — `payload_json` is already
the correct key name under the decision above.

**Violation inventory** (the exact response fields that must be renamed to
conform — this is a work order for a follow-up code change; this document
does not itself change any code):

| Endpoint | Response field(s) today | Corrected field name(s) |
|---|---|---|
| `POST /api/demo` (create and reuse-existing-grant responses) | `workspaceId`, `incidentId` | `workspace_id`, `incident_id` |
| `GET /api/workspaces/:id` (`members[]` only — the `workspace` object is already correct) | `members[].userId` | `members[].user_id` |
| `POST /api/workspaces/:id/invite` | `inviteUrl` | `invite_url` |
| `POST /api/workspaces/:id/tokens` | `tokenId` | `token_id` |
| `GET /api/workspaces/:id/tokens` (`tokens[]`) | `tokens[].createdAt`, `tokens[].lastUsedAt` | `tokens[].created_at`, `tokens[].last_used_at` |
| `POST /api/incidents/:id/evidence`, `GET /api/incidents/:id/evidence`, `GET /api/evidence/:id`, and the `evidence.uploaded` SSE event (all four share `services/evidence.js`'s `metadata()`) | `incidentId`, `entryId`, `uploadedBy`, `uploadedAt` | `incident_id`, `entry_id`, `uploaded_by`, `uploaded_at` |
| `GET /api/evidence/:id/custody` (`events[]`) | `events[].evidenceId`, `events[].actorUserId` | `events[].evidence_id`, `events[].actor_user_id` |
| `GET /api/workspaces/:id/search` (`results[]`) | `results[].incidentId`, `results[].incidentRef`, `results[].incidentTitle`, `results[].entryId` | `results[].incident_id`, `results[].incident_ref`, `results[].incident_title`, `results[].entry_id` |
| `GET /api/workspaces/:id/audit/verify` (present only when `valid:false`) | `brokenAtId` | `broken_at_id` |
| `entry.technique_tagged` SSE event | `entryId`, `techniqueId` | `entry_id`, `technique_id` |
| `GET /health` | `uptimeSeconds` | `uptime_seconds` |
| `POST /api/v1/ingest` (desktop sync response — not called by the web frontend, included for completeness of the API surface) | `incidentId`, `entryId` | `incident_id`, `entry_id` |

`GET /api/workspaces/:id/audit`'s field *names* are already correct
(`workspace_id`, `actor_user_id`, `target_type`, `target_id`, `prev_hash`,
`payload_json`, etc. — it returns a raw `audit_log` row); its only defect
is `payload_json`'s value type, covered above, not a rename.

### 5.1 Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` | none | `200 { "status": "ok", "uptimeSeconds": n, "db": "ok" }` or `503 { "status": "error", "db": "error" }` if a trivial `SELECT 1` fails |
| GET | `/downloads/ir-logger.py` | none | Streams the repo-root `ir-logger.py` file (the v1 desktop tool, §2.10) as a forced download — `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="ir-logger.py"`, same convention as evidence downloads (§7) so the browser always saves rather than renders the source. `404` if the file is somehow missing. Linked from the landing page's self-host section. |

### 5.2 Auth

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | none | `{ email, password, name, invite_token? }` | `201 { user: { id, email, name } }`, session cookie set. `400` if email already registered, password < 10 chars, or any field missing. `403` if `REGISTRATION_OPEN=false` and `invite_token` does not match a pending, unexpired, unaccepted invite for `email` (§2.9) — the message states this instance isn't accepting sign-ups, that the demo is available, and that the project can be self-hosted, without revealing why a given `invite_token` didn't qualify. Rate-limited: 5 registrations per IP per rolling 60-minute window (fixed-window, via Round 1's `rate-limit.js` factory — same fail-closed contract as every other limiter in this spec), then `429` until the window rolls; fail-closed on limiter storage error → `503`. Registration is unauthenticated (when open) and each account can create workspaces holding up to 200MB of evidence each, so this limiter is a required disk-exhaustion guard, not optional polish. |
| POST | `/api/auth/login` | none | `{ email, password }` | `200 { user }`, session cookie set. `401` on bad credentials. Rate-limited: 10 failed attempts per IP per 15-minute window, then `429` until the window rolls; fail-closed on limiter storage error → `503`. Unaffected by `REGISTRATION_OPEN` — existing accounts always log in. |
| POST | `/api/auth/logout` | session | — | `200 { success: true }` |
| GET | `/api/auth/google` | none | — | redirects to Google OAuth consent |
| GET | `/api/auth/google/callback` | none | — | on success, creates/links a `users` row by `google_id` (or by matching `email` if a password account already exists, linking `google_id` onto it) and redirects to `/`; on failure redirects to `/login?error=1` |
| GET | `/api/auth/session` | none | — | `200 { user: {...} \| null, workspaces: [{id, name, role}], google_enabled: bool, registration_open: bool }` — the frontend's "am I logged in" check; never errors, always 200. `google_enabled` reflects only whether `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (the same condition gating the Google strategy and routes below) — it is how `login.html`/`register.html` decide whether to show the "Continue with Google" button, and never exposes the client id, secret, or any other configuration detail. `registration_open` reflects `REGISTRATION_OPEN` (§2.9) — it is how `index.html`/`login.html`/`register.html` decide whether to show a "create an account" affordance. |

Public JSON boundaries reject non-string fields and cap email at 320 characters,
name/workspace name/invite/token name at 200 characters, and passwords at 1024
characters; malformed JSON returns `400` and bodies over 100KB return `413`.

**Session fixation**: registration, login, and the Google OAuth callback
all regenerate the session id on success (`req.session.regenerate(...)`
called before the new authenticated session is established, per
`express-session`'s documented mechanism — Passport does not do this
automatically) rather than reusing whatever session id the client
happened to arrive with. Critically, if the pre-auth session carried a
`demoWorkspaceId` grant (§9 point 2), that grant is **not** copied
forward into the regenerated session — a successful register/login always
starts from a clean session, so a demo session can never be silently
upgraded into (or confused with) a real authenticated session.

### 5.3 Workspaces

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/demo` | none | — | `201 { workspaceId, incidentId }`. Creates an `is_demo=1` workspace (`expires_at = now + 24h`), seeds the phishing → credential-access → lateral-movement incident from §9 point 1 in the same transaction, and sets `req.session.demoWorkspaceId` (§9 point 2) so the response's session cookie can immediately access that one workspace at owner-equivalent permission. Rate-limited: 3 creations per IP per rolling 24h window (fixed-window, per §8.3) → `429` over the limit; fail-closed on limiter storage error → `503`. See §9 for the full lifecycle (caps, expiry, sweep). |
| POST | `/api/workspaces` | session | `{ name }` | `201 { workspace }`, caller becomes `owner` |
| GET | `/api/workspaces` | session | — | `200 { workspaces: [...] }` — only workspaces the caller has a membership in |
| GET | `/api/workspaces/:id` | session (member) | — | `200 { workspace, members: [{userId, name, email, role}] }` |
| POST | `/api/workspaces/:id/invite` | session (owner) | `{ email, role }` | `201 { inviteUrl }` — `role` must be `analyst` or `viewer` (an owner cannot invite another owner via this endpoint; ownership transfer is a direct database action, out of scope for self-service) |
| POST | `/api/invites/:token/accept` | session | — | `200 { workspace }` — the raw `:token` from the URL is looked up by `sha256(token)` against `invites.token_hash`, exactly the same pattern §5.11 already uses for `api_tokens.token_hash` (the raw token is never stored, only its hash); creates the membership, sets `accepted_at`. An existing membership is never upgraded by a re-invite; the stored role is returned. `404` if the hash isn't found, the invite is expired (7-day expiry), or already accepted. |
| POST | `/api/workspaces/:id/tokens` | session (owner) | `{ name }` | `201 { token, tokenId }` — `token` (the raw bearer value) is returned exactly once |
| GET | `/api/workspaces/:id/tokens` | session (owner) | — | `200 { tokens: [{id, name, createdAt, lastUsedAt}] }` — never returns `token_hash` or the raw value |
| DELETE | `/api/workspaces/:id/tokens/:tokenId` | session (owner) | — | `200 { success: true }` |

### 5.4 Incidents

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/workspaces/:id/incidents` | session (owner\|analyst) | `{ title, summary?, severity }` | `201 { incident }` — `ref` auto-generated `IR-<year>-<seq>` (§10), `status='open'`, `opened_at=now`. If the workspace is a demo workspace (`is_demo=1`) and it already has 5 incidents (the seeded one plus up to 4 created since), returns `409` and creates nothing (§9 point 3's per-demo-workspace cap). |
| GET | `/api/workspaces/:id/incidents` | session (member) | query: `status?, severity?, limit?(default 50, max 200), offset?(default 0)` | `200 { incidents: [...], total }` — each incident object includes two fields not in the `incidents` table itself, computed at read time: `entry_count` (`COUNT(*)` of that incident's `entries` rows) and `last_activity_at` (the `MAX(created_at)` across that incident's `entries`, or the incident's own `opened_at` if it has zero entries yet) |
| GET | `/api/incidents/:id` | session (member) | — | `200 { incident }` — same shape as the list above, including `entry_count` and `last_activity_at` |
| PATCH | `/api/incidents/:id` | session (owner\|analyst) | any of `{ title, summary, severity, status }` | `200 { incident }`. Moving `status` to/from `closed` requires `owner`; `analyst` attempting that transition gets `403`. Every accepted change writes an `audit_log` row. `400` on an invalid `severity`/`status` enum value. |

### 5.5 Entries

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/incidents/:id/entries` | session (owner\|analyst) | `{ kind, occurred_at?, body_md, technique_ids?: [] }` | `201 { entry }`. `occurred_at` defaults to now if omitted. `technique_ids` are validated against `techniques.id`; unknown ids → `400`. `kind='timeline'` or `'note'` silently ignores `technique_ids` (technique tagging only applies to `technical` entries — enforced server-side, not just hidden in the UI). Broadcasts `entry.created` over SSE (§6). Writes an `audit_log` row (`action='entry.created'`). |
| GET | `/api/incidents/:id/entries` | session (member) | query: `since?` (an entry id — returns entries created after it, for SSE-reconnect backfill, §6), `kind?`, `limit?(default 100, max 500)` | `200 { entries: [...] }`, each with its tagged `technique_ids` inlined |
| GET | `/api/entries/:id` | session (member) | — | `200 { entry }` |

**Tenant scoping for the bare-id route**: `GET /api/entries/:id` takes only
an entry id, with no incident or workspace segment in the path — this is
exactly the shape the workspace guard exists to handle (§8.2), spelled
out explicitly here because it's easy to build this specific kind of
route wrong. The resolution path is `entries.incident_id → incidents.
workspace_id → workspace-guard.js`: the server looks up the entry's
`incident_id`, then that incident's `workspace_id`, then calls the guard
with that resolved workspace id — never trusting a workspace id from the
request. An entry that exists but belongs to a workspace the caller isn't
a member of returns `404`, identical to an entry that doesn't exist at
all (the cross-tenant rule stated once at the top of §5, restated here
because this route is the textbook shape for an ID0R-by-omission bug —
the same two-hop resolution pattern (child → parent → workspace →
guard) is what `GET /api/incidents/:id/matrix` already does, and what
§5.7's bare-id evidence routes (`GET /api/evidence/:id` and its
`/download`/`/custody` siblings, resolving `evidence.incident_id →
incidents.workspace_id`) must do too).

Every entry object returned by the three routes above includes both
`author_user_id` (the stored FK) and a denormalized `author_name` string,
resolved server-side by joining `users` on `entries.author_user_id` at
read time — it is never written into the `entries` row itself and never
cached. Because the join targets `users` (which this app never deletes
rows from — there is no user-deletion feature anywhere in this spec) and
not `memberships` (which can change independently, e.g. if a member's
role or access changes), `author_name` keeps resolving correctly and
keeps rendering in the historical timeline even for a user who is no
longer a member of the workspace — the historical record never loses its
"who said this" attribution.

### 5.6 Techniques + matrix

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/techniques` | session | query: `tactic?`, `q?` (matches id or name, case-insensitive substring) | `200 { techniques: [...] }` — reference data, not workspace-scoped |
| GET | `/api/incidents/:id/matrix` | session (member) | — | `200 { tactics: [{ tactic, techniques: [{ id, name, url, count }] }] }` — `count` is the number of distinct entries in this incident tagged with that technique; every seeded technique appears even at `count: 0` |

### 5.7 Evidence + custody

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/incidents/:id/evidence` | session (owner\|analyst) | `multipart/form-data`, field `file`, optional field `entry_id` | `201 { evidence }`. Hard caps: `25MB` per file (`5MB` if the incident's workspace `is_demo=1`), workspace-wide evidence total `200MB` (`20MB` if demo), and demo workspaces additionally cap at `5` evidence rows total. Exceeding any cap → `413` (file size) or `409` (count/total cap) *before* any bytes are written to disk. Writes `evidence` row + a `custody_events` row (`action='uploaded'`) **and** an `audit_log` row (`action='evidence.uploaded'`, `target_type='evidence'`, via Round 1's `audit.append()`) in one transaction — see §2.3's correction on why custody events are also hash-chained. Broadcasts `evidence.uploaded` over SSE. |
| GET | `/api/incidents/:id/evidence` | session (member) | — | `200 { evidence: [...] }` (metadata only, no `stored_path`) |
| GET | `/api/evidence/:id` | session (member) | — | `200 { evidence }` (metadata only). Tenant-scoped via `evidence.incident_id → incidents.workspace_id → workspace-guard.js`, same pattern as §5.5's entries. Writes a `custody_events` row **and** an `audit_log` row (`action='viewed'`/`'evidence.viewed'`). |
| GET | `/api/evidence/:id/download` | session (member) | — | `200`, binary stream, `Content-Type: application/octet-stream` (always — the original `mime` is never used as the response content-type, per §7), `Content-Disposition: attachment; filename="<sanitized display filename>"`. Same tenant-scoping as above. Writes a `custody_events` row **and** an `audit_log` row (`action='downloaded'`/`'evidence.downloaded'`). |
| GET | `/api/evidence/:id/custody` | session (member) | — | `200 { events: [...] }`, chronological, oldest first. Same tenant-scoping as above. |

### 5.8 Search

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/workspaces/:id/search` | session (member) | query: `q` (required, `400` if missing/blank) | `200 { results: [{ incidentId, incidentRef, incidentTitle, entryId, snippet, rank }] }`, ranked by FTS5 `bm25`, max 50 results |

**FTS5 query safety**: `q` is never interpolated into the `MATCH`
expression as raw FTS5 query syntax. Before building the `MATCH`
argument, the server escapes every `"` in `q` by doubling it (FTS5's own
escape for a quoted phrase) and wraps the entire, otherwise-untouched
query in a single pair of double quotes, so FTS5 always parses it as one
literal phrase rather than trying to interpret `-`, `*`, `:`, `(`, `)`,
or bare `AND`/`OR`/`NOT` as query syntax. Decision: this trades away
FTS5's boolean/prefix operators (a raw `q` of `phish* OR malware` will be
searched as the literal phrase `phish* OR malware`, not parsed as two
alternatives) for the simpler, safer guarantee that **no** input string
can produce an FTS5 syntax error — a malformed query returns `200` with
however many (possibly zero) results match the literal phrase, never a
`500`.

Before the `MATCH` argument is built, NUL and the entire C0 control range
are stripped from `q` and `q` is capped at 200 characters. `snippet`
results are safe for HTML insertion: the server passes non-HTML sentinel
markers to SQLite `snippet()`, HTML-escapes the returned string, then
replaces the sentinels with `<b>`/`</b>`. Client code must still treat the
`snippet` as trusted-server HTML (it is already escaped); it must not run
any additional unescaped user content through `innerHTML`.

### 5.9 Export + audit

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/incidents/:id/export.pdf` | session (member) | `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment`. Writes `audit_log` (`action='export'`). |
| GET | `/api/incidents/:id/export.md` | session (member) | `200`, `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment`. Writes `audit_log` (`action='export'`). |
| GET | `/api/workspaces/:id/audit` | session (owner) | `200 { entries: [...] }` paginated (`limit` default 100, max 500, `offset`), newest first |
| GET | `/api/workspaces/:id/audit/verify` | session (owner) | `200 { valid: true, checked: n }` or `200 { valid: false, checked: n, brokenAtId: "<audit_log.id>" }` — a broken chain is a `200` with `valid:false` in the body, not an HTTP error, since "the chain is broken" is itself a successful, correct answer from the verifier |

### 5.10 SSE stream

| Method | Path | Auth |
|---|---|---|
| GET | `/api/incidents/:id/stream` | session (member) |

See §6 for the event contract.

### 5.11 v1 desktop ingest

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/ingest` | token | `{ incident_ref, kind, category?, body, occurred_at?, author_name? }` | `201 { incidentId, entryId }`. `kind` must be `technical` or `timeline` (v1 has no `note` concept). If `category` is present (only meaningful for `technical`), the stored `body_md` is prefixed with `**Category:** <category>\n\n`. If `author_name` is present (v1's local OS username via `getpass.getuser()`), it is appended as a trailing line `\n\n_Originally logged by: <author_name> (desktop sync)_` — the entry's `author_user_id` is always the token's owning user (foreign-key integrity requires a real `users` row; the desktop username is provenance text, not an identity). If no incident with `ref = incident_ref` exists yet in the token's workspace, one is auto-created (`title: "Synced from desktop"`, `severity: 'medium'`, `status: 'open'`). Broadcasts `entry.created` over SSE exactly like §5.5. `401` if the token is invalid/unknown; updates `api_tokens.last_used_at` on success. |

**Two separate rate limits, not one** (the earlier draft only specified
one, which left the auth check itself unguarded): (1) a per-IP limiter on
*failed* token lookups only — bucket `v1-ingest-auth:<ip>`, 20 failures
per IP per 15-minute window, checked before the token lookup runs; once
an IP is over this limit, subsequent requests from it get `429`
immediately without even querying `api_tokens`, regardless of whether the
token in that particular request happens to be valid — this exists to
stop token brute-forcing/enumeration, which the per-token limiter below
can't stop since an attacker without a valid token never reaches it; (2)
the existing per-token limiter for successfully authenticated requests —
60 requests/minute per token, `429` over that. Both are fail-closed:
`503` on either limiter's storage error, never allowed through.

---

## 6. SSE event contract

`GET /api/incidents/:id/stream` is a standard `text/event-stream` response
(`Connection: keep-alive`, `Cache-Control: no-cache`, a `: heartbeat`
comment line every 25 seconds to keep intermediaries from timing the
connection out). Each event is:

```
event: <type>
id: <auto-incrementing per-process sequence number>
data: <JSON>

```

Event types and their `data` payload:

- `entry.created` — the full entry object as returned by §5.5 GET.
- `incident.updated` — `{ id, changes: { field: newValue, ... } }` for
  severity/status/title/summary changes (§2.4).
- `entry.technique_tagged` — `{ entryId, techniqueId }` (fired once per tag,
  immediately after `entry.created` for entries created with
  `technique_ids`, so the matrix can update live).
- `evidence.uploaded` — the evidence metadata object as returned by §5.7 GET
  (no `stored_path`).

The frontend's `EventSource` reconnects automatically per the spec's
built-in retry behavior. Decision: the server does not implement SSE
`Last-Event-ID` replay (the `id:` field is a per-process, not persisted,
sequence — it resets on server restart and is not queryable). Instead, on
every `EventSource` `open` event (fired both on first connect and after any
reconnect), the client calls `GET /api/incidents/:id/entries?since=<last
seen entry id>` once to backfill anything it might have missed during the
gap, then continues consuming the live stream. This is simpler and fully
correct (no missed entries) without needing a durable replay buffer.

---

## 7. Evidence security stances (restated as requirements)

- Uploaded evidence is **never** served with its original content-type.
  `GET /api/evidence/:id/download` always responds
  `Content-Type: application/octet-stream` regardless of the `mime` value
  recorded at upload time, and always
  `Content-Disposition: attachment; filename="<name>"` — the browser must
  never be given a reason to render the file inline.
- The display filename sent in `Content-Disposition` is derived from the
  original filename with path separators, control characters, and anything
  outside `[A-Za-z0-9._ -]` stripped, truncated to 200 characters; if
  stripping leaves it empty, the display filename is `evidence-<id>`.
- The on-disk path (`stored_path`) is always a generated id
  (`data/evidence/<24-char nanoid>.bin`) — the original filename is stored
  only in the `filename` database column for display, never used to
  construct a filesystem path.
- SHA-256 is computed by hashing the same byte stream as it is written to
  disk (a single pass, via a `crypto.createHash('sha256')` piped alongside
  the write stream) — never a second read-back of the file, so the hash
  provably matches exactly what was persisted.

---

## 8. Security stances (restated as requirements)

### 8.1 Guards before side effects

Every route that writes to the database, writes a file, or streams a
response containing tenant data runs its authentication check, its
workspace-membership check, and its input validation — in that order —
before touching the database or filesystem. There is no route where a
side effect can be observed to happen before all three checks pass.

### 8.2 Workspace guard — fail-closed

A single helper (owned by Round 1, `src/middleware/workspace-guard.js`) is
the *only* code path that resolves "does the current caller have access to
workspace X, and at what role." Every route in §5.3–§5.9 that touches
workspace-scoped data calls it. If the caller has no session, no matching
membership row, or the guard's own database query throws, the result is
`403` (or `404` per the cross-tenant rule in §5) — **never** a fallback to
"use the caller's first/only workspace" or any other default. There is no
"if exactly one workspace, assume that one" convenience path anywhere in
the codebase; the workspace id in the URL is always the one checked.

### 8.3 Rate limiters and the demo guard — fail-closed

Every rate limiter in this spec (§5.2 login, §5.11 ingest, §9 demo
creation) is backed by the `rate_limits` table (§4). If the `SELECT`/
`INSERT` against that table throws for any reason (locked database,
corruption, disk full), the limiter treats the request as **over the
limit** and returns `503` — it never fails open to "allow the request
through because we couldn't check." This is stated directly in the
limiter helper's code comments, not just here.

### 8.4 Append-only audit log (and custody log)

No `UPDATE` or `DELETE` SQL statement against `audit_log` **or
`custody_events`** exists anywhere in the codebase, including in tests,
except the demo sweeper (`src/services/demo-sweeper.js`) deleting rows of an
`is_demo=1` workspace past `expires_at` as part of whole-tenant deletion.
This is never row-level surgery on a live workspace's chain. Tests that need
a "dirty" chain to exercise `verify` construct the dirty state via a *raw*
`db.exec` against a disposable test database file,
clearly commented as a test-only integrity-check fixture, not through any
application code path. `custody_events` gets the identical rule because
§2.3 requires it: evidence-access history is forensically load-bearing,
so it is append-only by the same enforcement, not just by convention.

### 8.5 Accessibility baseline

Every page has a semantic landmark structure (`<header>`, `<nav>`,
`<main>`, `<footer>` as applicable) and a correct heading hierarchy.
Repeated data (the incident list, the timeline, the evidence list, the
audit log) is marked up as `<table>` or `<ul>/<ol>` with real `<li>`
items, never nested `<div>`s standing in for list/table semantics. Every
icon-only control (e.g. the copy-hash button on an evidence card) has an
`aria-label`. Focus outlines are never suppressed (no
`outline: none` without a visible replacement focus style — see
`DESIGN.md`). The timeline and the ATT&CK matrix are both fully operable
by keyboard alone (tab to a matrix cell, Enter/Space opens its detail
popover listing the entries that reference it).

### 8.6 Responsive baseline

The app is usable down to a 375px-wide phone screen. The ATT&CK matrix,
which is inherently wide (14 tactic columns), scrolls horizontally
*inside its own bordered container* (`overflow-x: auto` on the matrix
wrapper only) — the page `<body>` itself never scrolls horizontally at any
viewport width.

### 8.7 Every user-facing surface has four states

Loading, empty, error, success — for every list/detail view in the app
(incident list, timeline, matrix, evidence list, custody trail, search
results, audit log). Empty states are designed (an icon, a one-sentence
explanation, and — where relevant — a primary action button), never a
blank panel or a bare "No data." string. See `DESIGN.md` §Empty states for
the exact component spec.

### 8.8 Client IP derivation — fail-closed by construction, not just by code

Every per-IP rate limiter in this spec (§5.2 registration/login, §5.3
demo creation, §5.11 desktop-ingest failed-token) is only as trustworthy
as the client IP Express resolves `req.ip` to, and that resolution
depends entirely on the deployment's actual network path — this isn't
something the application code alone can guarantee, so it's stated here
as a hosting requirement, not just an app one. This app's real path is
`browser → nginx (one hop) → Node`, with the site **not** proxied through
Cloudflare (`scottslab.io`'s nameservers are Cloudflare's, but this
subdomain resolves straight to the origin — DNS-only, no orange-cloud
proxy layer sitting in front of nginx). Given exactly one real hop:

- `src/server.js` sets `app.set('trust proxy', 1)` — trusting exactly one
  hop, matching the real topology, per `AGENTS.md`.
- The nginx site for this app must **overwrite** the
  `X-Forwarded-For` header with the real peer address
  (`proxy_set_header X-Forwarded-For $remote_addr;`), **not** append to
  it (`... $proxy_add_x_forwarded_for;`, which most other sites on this
  box use).

  To be precise about why, because this is widely stated wrongly: an
  appending config is **not** exploitable at `trust proxy: 1`. Express's
  `proxy-addr` builds the candidate list as
  `[socketAddr, ...xffEntriesLeftToRight]`, trusts only index `0`, and
  returns index `1` — the **right-most** header entry, which is exactly
  the one nginx appended. A client-prepended forgery is structurally
  discarded. This was verified by tracing the installed `proxy-addr`
  source and reproducing it against forged single entries, multi-entry
  chains and malformed headers; every case yielded the real peer.

  The overwriting config is therefore **hardening, not a vulnerability
  fix**. Its value is that it removes the attacker-supplied prefix
  entirely, so the header cannot become spoofable if `trust proxy` is
  ever raised above the real hop count or set to `true` — both of which
  *are* attacker-controlled under an appending config, and both of which
  are realistic future mistakes. `trust proxy` is the security-relevant
  setting here; the nginx directive is the safety net under it.

  This is restated as an operator checklist item in `ROADMAP.md` since
  it's an nginx-config fact outside any agent's file set, not something a
  Devin session can verify from inside this repo.

---

## 9. Demo sandbox lifecycle

1. **Creation**: `POST /api/demo` (public, no auth). Two independent
   guards, both fail-closed, both checked before any row is written: (a)
   the per-IP rate limit — 3 creations per IP per rolling 24-hour window
   (fixed-window bucketed by UTC calendar day, per §8.3's fail-closed
   rule), else `429`; (b) a **global ceiling**, independent of source IP —
   at most 25 demo workspaces may be active (`is_demo=1 AND expires_at >
   now`) at once across the whole app. This exists because the per-IP
   limit alone doesn't stop an attacker with many source addresses from
   creating unbounded demo workspaces between sweeper runs; the global
   check is a plain `SELECT COUNT(*)` immediately before the insert, in
   the same transaction. If the count is at or over 25, or the count
   query itself throws, the request is denied `503` — fail-closed
   identically to every other capacity/limiter check in this spec; the
   two failure reasons (at capacity vs. couldn't check) are deliberately
   not distinguished in the response, to avoid giving an attacker a
   signal either way. On success, in one transaction: insert a
   `workspaces` row (`is_demo=1`,
   `expires_at = now + 24h`). The same transaction also inserts one synthetic
   `users` row (`is_demo=1`, name `"Demo visitor"`, email
   `demo-<workspaceId>@demo.invalid`, with no `password_hash` and no
   `google_id`); it owns all provenance columns for the seeded rows. Then
   insert one seeded `incidents` row (`ref:
   "IR-DEMO-0001"`, `title: "Suspicious login → lateral movement — Contoso
   Finance"`, `severity: 'high'`, `status: 'contained'`), insert 6 seeded
   `entries` (a realistic phishing → credential-access → lateral-movement
   narrative: (1) `technical`, tagged `T1566.001`, "Spearphishing email
   with malicious .xlsm attachment delivered to a Finance mailbox"; (2)
   `technical`, tagged `T1204.002`, "User opened attachment, macro
   executed"; (3) `timeline`, "Endpoint alert fired, IR triggered"; (4)
   `technical`, tagged `T1003.001`, "LSASS memory access observed on the
   patient-zero host"; (5) `technical`, tagged `T1021.001`, "RDP session
   from patient-zero to a finance file server using harvested
   credentials"; (6) `note`, "Finance file server isolated from the
   network at 14:32 UTC"), insert one seeded `evidence` row referencing a
   real generated file `phishing-email-headers.txt` (a fabricated-but-
   plausible email header block, written to disk at seed time so its
   `sha256` is genuinely computed, not hard-coded). No response body
   secret is needed: the response sets the session (see next point) and
   returns `{ workspaceId, incidentId }` for the frontend to redirect into.
2. **Session**: the response also sets `req.session.demoWorkspaceId =
   workspace.id`. No `memberships` row exists and the visitor still is not a
   real account: access comes solely from `req.session.demoWorkspaceId`.
   A synthetic `users` row does exist for provenance. The workspace guard (§8.2) accepts
   *either* a real membership row *or* an exact match between the
   requested workspace id and `req.session.demoWorkspaceId`, granting
   `owner`-equivalent permissions for that one workspace only. Any
   mismatch (wrong workspace id, no session) is a normal fail-closed `403`/
   `404` — there is no broader "any demo session can access any demo
   workspace" shortcut.
3. **Caps while active**: demo workspaces cap evidence at 5 files / 5MB per
   file / 20MB total (§5.7), and cap total incidents per demo workspace at
   5 (the 1 seeded + up to 4 created by the visitor) — creating a 6th
   returns `409`.
4. **Expiry + sweep**: an in-process interval (every 15 minutes — this is a
   long-running `pm2` process, not a serverless function, so an in-process
   timer is the appropriate mechanism here, not an anti-pattern; see
   `AGENTS.md`) finds every `workspaces` row with `is_demo=1 AND expires_at
   < now`, and for each, **independently** (one workspace's failure must
   never stop the others in the same tick — the sweeper iterates the list
   and wraps each workspace's cleanup in its own `try/catch`, continuing
   to the next workspace on any error rather than aborting the whole
   run): in one transaction, deletes its evidence files from disk
   (`stored_path`) — a file that's already missing (`ENOENT` from the
   delete call) counts as **success**, not failure, since the end state
   ("this file is gone") is exactly what was wanted, whether the sweeper
   or something else removed it — then deletes its `custody_events`,
   `evidence`, `entry_techniques`, `entries`, `incidents`, `audit_log`,
   `api_tokens`, `invites`, `memberships`, synthetic `users` rows, then the
   `workspaces` row
   itself. A workspace whose cleanup throws for a real reason (not
   `ENOENT` — e.g. a locked file, a permissions error) is logged with its
   workspace id and left for the next tick to retry; it is not deleted
   from `workspaces` (so it isn't silently forgotten) and its partial
   database state from that failed attempt is rolled back by the
   transaction, so it's never left half-deleted. After iterating every
   expired workspace, logs a one-line summary (`swept N expired demo
   workspace(s), M failed`) to stdout for the `pm2` log.

---

## 10. Incident ref generation

`ref` is generated inside the same transaction as the `incidents` insert:
`SELECT COUNT(*) FROM incidents WHERE workspace_id = ? AND ref LIKE
'IR-<currentYear>-%'`, `+1`, zero-padded to 4 digits:
`IR-2026-0001`, `IR-2026-0002`, ... Because `better-sqlite3` is
synchronous and single-threaded within the Node process, the count-then-
insert pair cannot interleave with another request's count-then-insert —
this is safe without an explicit lock. The demo seed incident (§9) uses the
fixed literal `IR-DEMO-0001` instead of this counter (it is not a real
year-numbered incident).

---

## 11. Markdown subset for `entries.body_md`

Decision: a small, deliberately constrained Markdown subset, implemented as
a hand-written renderer (no library — see `AGENTS.md`'s dependency list).
Supported constructs only:

- Paragraphs, separated by a blank line.
- `**bold**`, `*italic*`, `` `inline code` ``.
- Fenced code blocks (```` ``` ````) rendered as `<pre><code>`.
- Bullet lists (`- ` or `* ` at line start) and numbered lists (`1. `).
- Two heading levels only: `## ` and `### `.
- Links `[text](url)` where `url`'s scheme must be `http:`, `https:`, or
  `mailto:` — any other scheme (including `javascript:`) is rejected and
  the link renders as plain escaped text instead. The scheme check is
  **not** a naive `url.startsWith('http')`: before comparing, strip any
  leading whitespace and ASCII control characters (`\t`, `\n`, `\r`, and
  other C0 controls) from `url`, then lowercase it, then check the
  prefix. This exists specifically because browsers themselves strip
  leading whitespace/control characters when parsing a URL, so a payload
  like `" \tjavascript:alert(1)"` or `"JavaScript:alert(1)"` would satisfy
  a naive case-sensitive, no-strip `startsWith` check's *letter* while
  still executing as `javascript:` once a browser parses it — the check
  must normalize the same way a browser would before comparing, or the
  allowlist is a bypassable illusion of safety. Rendered links get
  `rel="noopener noreferrer" target="_blank"`.
- A single newline inside a paragraph becomes `<br>`.

No images, no tables, no blockquotes, and — critically — **no raw HTML
passthrough**: every character in `body_md` is HTML-escaped first, and only
then are the constructs above re-introduced as HTML tags by the renderer.
This is a hard security requirement (the only defense between analyst-
authored incident notes, which may contain attacker-controlled strings
copy-pasted from phishing emails or logs, and stored XSS). This subset is
implemented twice by design — once server-side (used for PDF/Markdown
export layout) and once client-side (used to render the live timeline) —
because there is no build step to share a module between the CommonJS
server code and the ES-module browser code (§`AGENTS.md`). Both
implementations follow this exact subset definition, so they stay in sync
by spec rather than by shared code.
