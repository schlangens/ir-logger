const fs = require('node:fs');
const path = require('node:path');
const { evidenceDir } = require('../uploads/storage');

const evidenceRoot = path.resolve(evidenceDir);

function isInsideEvidenceDir(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === evidenceRoot || resolved.startsWith(`${evidenceRoot}${path.sep}`);
}

function sweep(db) {
  const now = new Date().toISOString();
  let workspaces;
  try {
    workspaces = db
      .prepare('SELECT id FROM workspaces WHERE is_demo=1 AND expires_at < ?')
      .all(now);
  } catch (error) {
    console.error('demo sweep lookup failed', error);
    return { swept: 0, failed: 0 };
  }

  let swept = 0;
  let failed = 0;
  for (const { id: workspaceId } of workspaces) {
    try {
      db.transaction(() => {
        const files = db
          .prepare(
            `SELECT e.stored_path
             FROM evidence e
             JOIN incidents i ON i.id=e.incident_id
             WHERE i.workspace_id=?`,
          )
          .all(workspaceId);
        for (const { stored_path: storedPath } of files) {
          const filePath = path.isAbsolute(storedPath)
            ? path.resolve(storedPath)
            : path.resolve(evidenceDir, storedPath);
          if (!isInsideEvidenceDir(filePath)) {
            console.error(`demo sweep skipping out-of-bounds path: ${storedPath}`);
            continue;
          }
          try {
            fs.unlinkSync(filePath);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        db.prepare(
          'DELETE FROM custody_events WHERE evidence_id IN (SELECT e.id FROM evidence e JOIN incidents i ON i.id=e.incident_id WHERE i.workspace_id=?)',
        ).run(workspaceId);
        db.prepare(
          'DELETE FROM evidence WHERE incident_id IN (SELECT id FROM incidents WHERE workspace_id=?)',
        ).run(workspaceId);
        db.prepare(
          'DELETE FROM entry_techniques WHERE entry_id IN (SELECT e.id FROM entries e JOIN incidents i ON i.id=e.incident_id WHERE i.workspace_id=?)',
        ).run(workspaceId);
        db.prepare(
          'DELETE FROM entries WHERE incident_id IN (SELECT id FROM incidents WHERE workspace_id=?)',
        ).run(workspaceId);
        db.prepare('DELETE FROM incidents WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM audit_log WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM api_tokens WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM invites WHERE workspace_id=?').run(workspaceId);
        db.prepare('DELETE FROM memberships WHERE workspace_id=?').run(workspaceId);
        db.prepare(
          "DELETE FROM users WHERE is_demo=1 AND email='demo-'||?||'@demo.invalid'",
        ).run(workspaceId);
        db.prepare('DELETE FROM workspaces WHERE id=? AND is_demo=1').run(workspaceId);
      })();
      swept++;
    } catch (error) {
      failed++;
      console.error(`demo workspace ${workspaceId} sweep failed`, error);
    }
  }
  console.log(`swept ${swept} expired demo workspace(s), ${failed} failed`);
  return { swept, failed };
}

function start(db, { intervalMs = 15 * 60 * 1000 } = {}) {
  const timer = setInterval(() => sweep(db), intervalMs);
  timer.unref();
  return timer;
}
module.exports = { start, sweep };
