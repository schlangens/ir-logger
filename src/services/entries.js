const { nanoid } = require('nanoid');
const audit = require('./audit');
const hub = require('../sse/hub');

function hydrate(db, id) {
  const entry = db.prepare(`SELECT e.*, u.name AS author_name
    FROM entries e JOIN users u ON u.id=e.author_user_id WHERE e.id=?`).get(id);
  if (!entry) return null;
  entry.technique_ids = db.prepare('SELECT technique_id FROM entry_techniques WHERE entry_id=? ORDER BY rowid').all(id).map((r) => r.technique_id);
  return entry;
}
function resolveEntryParent(db, id) {
  return db.prepare('SELECT e.id,e.incident_id,i.workspace_id FROM entries e JOIN incidents i ON i.id=e.incident_id WHERE e.id=?').get(id);
}

function createEntry(db, { incidentId, userId, kind, occurredAt, bodyMd, techniqueIds = [] }) {
  const id = nanoid(16);
  const tags = kind === 'technical' ? [...new Set(techniqueIds)] : [];
  let entry;
  db.transaction(() => {
    if (tags.length) {
      const placeholders = tags.map(() => '?').join(',');
      const found = db.prepare(`SELECT id FROM techniques WHERE id IN (${placeholders})`).all(...tags).map((r) => r.id);
      if (found.length !== tags.length) throw Object.assign(new Error('Unknown technique'), { status: 400 });
    }
    db.prepare('INSERT INTO entries(id,incident_id,kind,occurred_at,body_md,author_user_id) VALUES(?,?,?,?,?,?)')
      .run(id, incidentId, kind, occurredAt, bodyMd, userId);
    for (const techniqueId of tags) db.prepare('INSERT INTO entry_techniques(entry_id,technique_id) VALUES(?,?)').run(id, techniqueId);
    const incident = db.prepare('SELECT workspace_id FROM incidents WHERE id=?').get(incidentId);
    audit.append(db, { workspaceId: incident.workspace_id, actorUserId: userId, action: 'entry.created', targetType: 'entry', targetId: id, payload: { kind } });
    entry = hydrate(db, id);
  })();
  hub.broadcast(incidentId, 'entry.created', entry);
  for (const techniqueId of tags) hub.broadcast(incidentId, 'entry.technique_tagged', { entryId: id, techniqueId });
  return entry;
}

function listEntries(db, incidentId, { since, kind, limit = 100 } = {}) {
  const clauses = ['e.incident_id=?']; const args = [incidentId];
  if (since) {
    const row = db.prepare('SELECT rowid FROM entries WHERE id=? AND incident_id=?').get(since, incidentId);
    if (!row) return [];
    clauses.push('e.rowid>?'); args.push(row.rowid);
  }
  if (kind) { clauses.push('e.kind=?'); args.push(kind); }
  const ids = db.prepare(`SELECT e.id FROM entries e WHERE ${clauses.join(' AND ')} ORDER BY e.rowid LIMIT ?`).all(...args, limit).map((r) => r.id);
  return ids.map((id) => hydrate(db, id));
}

module.exports = { createEntry, hydrate, resolveEntryParent, listEntries };
