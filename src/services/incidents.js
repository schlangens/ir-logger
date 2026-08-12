const { nanoid } = require('nanoid');
const audit = require('./audit');

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'contained', 'eradicated', 'recovered', 'closed'];

function incidentSelect() {
  return `SELECT i.*, COUNT(e.id) AS entry_count,
    COALESCE(MAX(e.created_at), i.opened_at) AS last_activity_at
    FROM incidents i LEFT JOIN entries e ON e.incident_id=i.id`;
}

function readIncident(db, id) {
  return db.prepare(`${incidentSelect()} WHERE i.id=? GROUP BY i.id`).get(id);
}
function resolveIncident(db, id) {
  return db.prepare('SELECT id,workspace_id FROM incidents WHERE id=?').get(id);
}
function findIncidentByRef(db, workspaceId, ref) {
  return db.prepare('SELECT id FROM incidents WHERE workspace_id=? AND ref=?').get(workspaceId, ref);
}
// These API-token helpers live here because the assigned file set has no ingest service module.
function findApiToken(db, tokenHash) {
  return db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(tokenHash);
}
function touchApiToken(db, id, at) {
  db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(at, id);
}

function createIncident(db, { workspaceId, userId, title, summary = '', severity, ref }) {
  if (!SEVERITIES.includes(severity)) throw Object.assign(new Error('Invalid severity'), { status: 400 });
  const id = nanoid(16);
  let incident;
  db.transaction(() => {
    const workspace = db.prepare('SELECT is_demo FROM workspaces WHERE id=?').get(workspaceId);
    if (!workspace) throw Object.assign(new Error('Workspace not found'), { status: 404 });
    if (workspace.is_demo && db.prepare('SELECT COUNT(*) AS count FROM incidents WHERE workspace_id=?').get(workspaceId).count >= 5)
      throw Object.assign(new Error('Demo incident limit reached'), { status: 409 });
    let incidentRef = ref;
    if (!incidentRef) {
      const year = new Date().getUTCFullYear();
      const prefix = `IR-${year}-`;
      const count = db.prepare('SELECT COUNT(*) AS count FROM incidents WHERE workspace_id=? AND ref LIKE ?').get(workspaceId, `${prefix}%`).count;
      incidentRef = `${prefix}${String(count + 1).padStart(4, '0')}`;
    }
    db.prepare('INSERT INTO incidents(id,workspace_id,ref,title,summary,severity,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, workspaceId, incidentRef, title, summary, severity, 'open', userId);
    audit.append(db, {
      workspaceId, actorUserId: userId, action: 'incident.created', targetType: 'incident', targetId: id,
      payload: { ref: incidentRef, title, summary, severity, status: 'open' },
    });
    incident = readIncident(db, id);
  })();
  return incident;
}

function listIncidents(db, workspaceId, { status, severity, limit = 50, offset = 0 } = {}) {
  const clauses = ['i.workspace_id=?'];
  const args = [workspaceId];
  if (status) { clauses.push('i.status=?'); args.push(status); }
  if (severity) { clauses.push('i.severity=?'); args.push(severity); }
  const where = clauses.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS count FROM incidents i WHERE ${where}`).get(...args).count;
  const incidents = db.prepare(`${incidentSelect()} WHERE ${where} GROUP BY i.id ORDER BY i.rowid DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { incidents, total };
}

function updateIncident(db, { id, userId, workspaceId, role, changes }) {
  const before = readIncident(db, id);
  if (!before || before.workspace_id !== workspaceId) return null;
  const accepted = {};
  for (const key of ['title', 'summary', 'severity', 'status']) {
    if (Object.hasOwn(changes, key)) accepted[key] = changes[key];
  }
  if (accepted.severity !== undefined && !SEVERITIES.includes(accepted.severity))
    throw Object.assign(new Error('Invalid severity'), { status: 400 });
  if (accepted.status !== undefined && !STATUSES.includes(accepted.status))
    throw Object.assign(new Error('Invalid status'), { status: 400 });
  if (accepted.status !== undefined && accepted.status !== before.status && (accepted.status === 'closed' || before.status === 'closed') && role !== 'owner')
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  const changed = Object.fromEntries(Object.entries(accepted).filter(([key, value]) => value !== before[key]));
  if (!Object.keys(changed).length) return { before, after: before, changes: {} };
  const sets = Object.keys(changed).map((key) => `${key}=?`);
  const values = Object.keys(changed).map((key) => changed[key]);
  if (changed.status === 'closed') { sets.push('closed_at=?'); values.push(new Date().toISOString()); }
  else if (changed.status !== undefined && before.status === 'closed') { sets.push('closed_at=?'); values.push(null); }
  values.push(id);
  let after;
  db.transaction(() => {
    db.prepare(`UPDATE incidents SET ${sets.join(',')} WHERE id=?`).run(...values);
    for (const [field, value] of Object.entries(changed))
      audit.append(db, { workspaceId, actorUserId: userId, action: 'incident.updated', targetType: 'incident', targetId: id, payload: { field, before: before[field], after: value } });
    after = readIncident(db, id);
  })();
  return { before, after, changes: changed };
}

module.exports = { SEVERITIES, STATUSES, createIncident, readIncident, resolveIncident, findIncidentByRef, findApiToken, touchApiToken, listIncidents, updateIncident };
