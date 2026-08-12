const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('../foundation/helpers');
const custody = require('../../src/services/custody');

test('custody append writes a custody row and a matching audit row', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  // Test-only fixture rows establish the foreign-key parents for the helper.
  db.prepare('INSERT INTO workspaces (id,name) VALUES (?,?)').run('workspace', 'Workspace');
  db.prepare(
    'INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)',
  ).run('user', 'user@example.test', 'User', 'hash');
  db.prepare(
    'INSERT INTO incidents (id,workspace_id,ref,title,severity,created_by) VALUES (?,?,?,?,?,?)',
  ).run('incident', 'workspace', 'IR-TEST-0001', 'Incident', 'low', 'user');
  db.prepare(
    `INSERT INTO evidence
      (id,incident_id,filename,mime,size,sha256,stored_path,uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)`,
  ).run('evidence', 'incident', 'file.txt', 'text/plain', 1, 'hash', '/tmp/file', 'user');

  db.transaction(() =>
    custody.append(db, {
      evidenceId: 'evidence',
      workspaceId: 'workspace',
      actorUserId: 'user',
      action: 'viewed',
    }),
  )();

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM custody_events WHERE evidence_id=?').get('evidence')
      .count,
    1,
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT action,target_type,target_id FROM audit_log WHERE action='evidence.viewed'",
      )
      .get(),
    { action: 'evidence.viewed', target_type: 'evidence', target_id: 'evidence' },
  );
});
