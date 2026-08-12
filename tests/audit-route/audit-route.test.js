const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { db: makeDb } = require('../foundation/helpers');
const { createApp } = require('../../src/server');
async function register(app, email, name) {
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/register').send({ email, name, password: 'long-password' })).status, 201);
  return agent;
}
function close(app, database) { app.locals.sessionStore.stopCleanup(); database.close(); }

test('audit list is owner-only and verify reports clean and broken chains', async (t) => {
  const { db: database } = makeDb(); const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'audit-owner@example.test', 'Owner');
  const analyst = await register(app, 'audit-analyst@example.test', 'Analyst');
  const viewer = await register(app, 'audit-viewer@example.test', 'Viewer');
  const other = await register(app, 'audit-other@example.test', 'Other');
  const workspace = (await owner.post('/api/workspaces').send({ name: 'Audit' })).body.workspace.id;
  const user = (email) => database.prepare('SELECT id FROM users WHERE email=?').get(email).id;
  database.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)').run(user('audit-analyst@example.test'), workspace, 'analyst');
  database.prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)').run(user('audit-viewer@example.test'), workspace, 'viewer');
  assert.equal((await analyst.get(`/api/workspaces/${workspace}/audit`)).status, 403);
  assert.equal((await viewer.get(`/api/workspaces/${workspace}/audit`)).status, 403);
  assert.equal((await other.get(`/api/workspaces/${workspace}/audit`)).status, 404);
  const listed = await owner.get(`/api/workspaces/${workspace}/audit?limit=1`);
  assert.equal(listed.status, 200); assert.equal(listed.body.entries.length, 1);
  assert.equal((await owner.get(`/api/workspaces/${workspace}/audit/verify`)).body.valid, true);
  const row = database.prepare('SELECT id FROM audit_log WHERE workspace_id=? ORDER BY rowid LIMIT 1').get(workspace);
  database.prepare('UPDATE audit_log SET payload_json=? WHERE id=?').run('{"corrupted":true}', row.id); // Test-only corruption; production code never updates audit_log.
  const broken = await owner.get(`/api/workspaces/${workspace}/audit/verify`);
  assert.equal(broken.status, 200); assert.equal(broken.body.valid, false); assert.equal(broken.body.brokenAtId, row.id);
});
