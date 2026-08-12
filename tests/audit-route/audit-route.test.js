const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { db: makeDb } = require('../foundation/helpers');
const { createApp } = require('../../src/server');
const audit = require('../../src/services/audit');

async function register(app, email, name) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .send({ email, name, password: 'long-password' });
  assert.equal(response.status, 201);
  return agent;
}

function close(app, database) {
  app.locals.sessionStore.stopCleanup();
  database.close();
}

function userId(database, email) {
  return database.prepare('SELECT id FROM users WHERE email=?').get(email).id;
}

test('audit list is owner-only, paginated newest-first, and verifies the chain', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'audit-owner@example.test', 'Owner');
  const analyst = await register(app, 'audit-analyst@example.test', 'Analyst');
  const viewer = await register(app, 'audit-viewer@example.test', 'Viewer');
  const other = await register(app, 'audit-other@example.test', 'Other');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Audit' })
  ).body.workspace.id;
  for (const [email, role] of [
    ['audit-analyst@example.test', 'analyst'],
    ['audit-viewer@example.test', 'viewer'],
  ]) {
    database
      .prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)')
      .run(userId(database, email), workspace, role);
  }
  const auditIds = [];
  for (let index = 0; index < 4; index++) {
    auditIds.push(
      audit.append(database, {
        workspaceId: workspace,
        actorUserId: userId(database, 'audit-owner@example.test'),
        action: `test-${index}`,
        targetType: 'test',
        targetId: `target-${index}`,
        payload: {},
      }).id,
    );
  }
  assert.equal((await analyst.get(`/api/workspaces/${workspace}/audit`)).status, 403);
  assert.equal((await viewer.get(`/api/workspaces/${workspace}/audit`)).status, 403);
  assert.equal((await other.get(`/api/workspaces/${workspace}/audit`)).status, 404);
  const listed = await owner.get(`/api/workspaces/${workspace}/audit?limit=2`);
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.entries.map((entry) => entry.id),
    auditIds.slice(-2).reverse(),
  );
  assert.ok(listed.body.entries.every((entry) => typeof entry.payload_json === 'object'));
  const offset = await owner.get(`/api/workspaces/${workspace}/audit?limit=1&offset=2`);
  assert.equal(offset.body.entries[0].id, auditIds[auditIds.length - 3]);
  const clamped = await owner.get(`/api/workspaces/${workspace}/audit?limit=1000`);
  assert.ok(clamped.body.entries.length <= 500);
  const clean = await owner.get(`/api/workspaces/${workspace}/audit/verify`);
  assert.equal(clean.status, 200);
  assert.equal(clean.body.valid, true);
  const row = database
    .prepare('SELECT id FROM audit_log WHERE workspace_id=? ORDER BY rowid LIMIT 1')
    .get(workspace);
  database
    .prepare('UPDATE audit_log SET payload_json=? WHERE id=?')
    .run('{"corrupted":true}', row.id); // Test-only corruption; production code never updates audit_log.
  const broken = await owner.get(`/api/workspaces/${workspace}/audit/verify`);
  assert.equal(broken.status, 200);
  assert.equal(broken.body.valid, false);
  assert.equal(broken.body.broken_at_id, row.id);
});

test('audit list rejects non-numeric limit and clamps limit=0 to 1', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'audit-limit-owner@example.test', 'Owner');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Audit limit' })
  ).body.workspace.id;
  for (let i = 0; i < 3; i++) {
    audit.append(database, {
      workspaceId: workspace,
      actorUserId: userId(database, 'audit-limit-owner@example.test'),
      action: `limit-${i}`,
      targetType: 'test',
      targetId: `target-${i}`,
      payload: {},
    });
  }
  const garbage = await owner.get(`/api/workspaces/${workspace}/audit?limit=abc`);
  assert.equal(garbage.status, 400);
  const zero = await owner.get(`/api/workspaces/${workspace}/audit?limit=0`);
  assert.equal(zero.status, 200);
  assert.equal(zero.body.entries.length, 1);
  const negative = await owner.get(`/api/workspaces/${workspace}/audit?limit=-1`);
  assert.equal(negative.status, 200);
  assert.equal(negative.body.entries.length, 1);
  const large = await owner.get(`/api/workspaces/${workspace}/audit?limit=1000`);
  assert.equal(large.status, 200);
  assert.ok(large.body.entries.length <= 500);
});

test('workspace guard failures deny both audit routes without leaking data', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'audit-guard@example.test', 'Owner');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Audit guard' })
  ).body.workspace.id;
  database.exec('DROP TABLE memberships'); // Test-only corruption forces workspace-guard fail-closed behavior.
  for (const suffix of ['audit', 'audit/verify']) {
    const response = await owner.get(`/api/workspaces/${workspace}/${suffix}`);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Unable to resolve workspace access' });
  }
});
