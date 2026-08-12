
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