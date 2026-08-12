const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('./helpers');
const audit = require('../../src/services/audit');

function appendThree(db, workspaceId) {
  for (let i = 0; i < 3; i++)
    audit.append(db, {
      workspaceId,
      action: 'entry.created',
      targetType: 'entry',
      targetId: String(i),
      payload: { i },
    });
}

test('audit chain verifies and detects tampered hash', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare("INSERT INTO workspaces (id, name) VALUES ('a', 'A'), ('b', 'B')").run();
  appendThree(db, 'a');
  audit.append(db, {
    workspaceId: 'b',
    action: 'x',
    targetType: 'x',
    targetId: 'b',
    payload: {},
  });
  assert.deepEqual(audit.verify(db, 'a'), { valid: true, checked: 3 });
  const middle = db
    .prepare("SELECT id FROM audit_log WHERE workspace_id = 'a' ORDER BY rowid LIMIT 1 OFFSET 1")
    .get();
  // Test-only raw-SQL integrity fixture: corrupt the middle hash.
  db.exec(`UPDATE audit_log SET hash = 'bad' WHERE id = '${middle.id}'`);
  assert.deepEqual(audit.verify(db, 'a'), {
    valid: false,
    checked: 2,
    brokenAtId: middle.id,
  });
  assert.equal(audit.verify(db, 'b').valid, true);
});

test('audit verifier detects tampered prev_hash', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare("INSERT INTO workspaces (id, name) VALUES ('a', 'A')").run();
  appendThree(db, 'a');
  const row = db
    .prepare("SELECT id FROM audit_log WHERE workspace_id = 'a' ORDER BY rowid LIMIT 1 OFFSET 2")
    .get();
  // Test-only raw-SQL integrity fixture: corrupt the third row's prev_hash.
  db.exec(`UPDATE audit_log SET prev_hash = '${'f'.repeat(64)}' WHERE id = '${row.id}'`);
  assert.deepEqual(audit.verify(db, 'a'), {
    valid: false,
    checked: 3,
    brokenAtId: row.id,
  });
});
