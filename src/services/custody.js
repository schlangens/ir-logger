const { nanoid } = require('nanoid');
const audit = require('./audit');

function append(db, { evidenceId, workspaceId, actorUserId, action, note = null }) {
  if (!actorUserId) throw new Error('custody append requires actorUserId');
  if (!evidenceId) throw new Error('custody append requires evidenceId');
  if (!workspaceId) throw new Error('custody append requires workspaceId');
  if (!action) throw new Error('custody append requires action');

  const id = nanoid(16);
  db.prepare(
    'INSERT INTO custody_events (id,evidence_id,action,actor_user_id,note) VALUES (?,?,?,?,?)',
  ).run(id, evidenceId, action, actorUserId, note);
  audit.append(db, {
    workspaceId,
    actorUserId,
    action: `evidence.${action}`,
    targetType: 'evidence',
    targetId: evidenceId,
    payload: { evidenceId, action, note },
  });
  return { id, evidenceId, action, actorUserId, note };
}

function list(db, evidenceId) {
  return db
    .prepare(
      'SELECT id,evidence_id,action,actor_user_id,at,note FROM custody_events WHERE evidence_id=? ORDER BY at ASC, rowid ASC',
    )
    .all(evidenceId)
    .map((row) => ({
      id: row.id,
      evidenceId: row.evidence_id,
      action: row.action,
      actorUserId: row.actor_user_id,
      at: row.at,
      note: row.note,
    }));
}

module.exports = { append, list };
