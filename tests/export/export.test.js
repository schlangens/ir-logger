const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { db: makeDb } = require('../foundation/helpers');
const { createApp } = require('../../src/server');
const payloads = require('../fixtures/markdown-xss-payloads');
const { renderMarkdown } = require('../../src/services/markdown-render');

async function register(app, email, name) {
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/register').send({ email, name, password: 'long-password' })).status, 201);
  return agent;
}
function close(app, database) { app.locals.sessionStore.stopCleanup(); database.close(); }
function seed(database, userId, workspaceId, body = 'Evidence observed') {
  database.prepare('INSERT INTO incidents (id,workspace_id,ref,title,summary,severity,created_by) VALUES (?,?,?,?,?,?,?)')
    .run('incident-id-0001', workspaceId, 'IR-2025-001', 'Phishing investigation', 'Full report', 'high', userId);
  database.prepare('INSERT INTO entries (id,incident_id,kind,occurred_at,body_md,author_user_id) VALUES (?,?,?,?,?,?)')
    .run('entry-id-0001', 'incident-id-0001', 'technical', '2025-01-01T00:00:00.000Z', body, userId);
  database.prepare('INSERT INTO entry_techniques (entry_id,technique_id) VALUES (?,?)').run('entry-id-0001', 'T1566.001');
}

test('PDF and Markdown exports include report content and append one export audit row', async (t) => {
  const { db: database } = makeDb(); const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'export-owner@example.test', 'Owner');
  const workspace = (await owner.post('/api/workspaces').send({ name: 'Exports' })).body.workspace.id;
  const userId = database.prepare('SELECT id FROM users WHERE email=?').get('export-owner@example.test').id;
  seed(database, userId, workspace);
  const pdf = await owner.get('/api/incidents/incident-id-0001/export.pdf');
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf'); assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  const markdown = await owner.get('/api/incidents/incident-id-0001/export.md');
  assert.equal(markdown.status, 200); assert.match(markdown.headers['content-type'], /^text\/markdown; charset=utf-8/);
  assert.match(markdown.text, /IR-2025-001/); assert.match(markdown.text, /Evidence observed/); assert.match(markdown.text, /T1566\.001/);
  const rows = database.prepare("SELECT action,target_id FROM audit_log WHERE action='export'").all();
  assert.equal(rows.length, 2); assert.deepEqual(rows.map((row) => row.target_id), ['incident-id-0001', 'incident-id-0001']);
});

test('Markdown payloads are escaped and PDF generation does not throw', async (t) => {
  const { db: database } = makeDb(); const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'xss-owner@example.test', 'Owner');
  const workspace = (await owner.post('/api/workspaces').send({ name: 'XSS' })).body.workspace.id;
  const userId = database.prepare('SELECT id FROM users WHERE email=?').get('xss-owner@example.test').id;
  for (const payload of payloads) {
    const tokens = renderMarkdown(payload.input);
    assert.ok(Array.isArray(tokens));
    for (const forbidden of payload.mustNotContain) assert.equal(JSON.stringify(tokens).includes(forbidden), false, `${payload.name}: renderer`);
    database.prepare('INSERT INTO incidents (id,workspace_id,ref,title,summary,severity,created_by) VALUES (?,?,?,?,?,?,?)')
      .run(`incident-${payload.name}`, workspace, `IR-${payload.name}`, 'XSS', '', 'low', userId);
    database.prepare('INSERT INTO entries (id,incident_id,kind,occurred_at,body_md,author_user_id) VALUES (?,?,?,?,?,?)')
      .run(`entry-${payload.name}`, `incident-${payload.name}`, 'note', '2025-01-01T00:00:00.000Z', payload.input, userId);
    const markdown = await owner.get(`/api/incidents/incident-${encodeURIComponent(payload.name)}/export.md`);
    assert.equal(markdown.status, 200);
    for (const forbidden of payload.mustNotContain) assert.equal(markdown.text.includes(forbidden), false, `${payload.name}: markdown`);
    assert.equal((await owner.get(`/api/incidents/incident-${encodeURIComponent(payload.name)}/export.pdf`)).status, 200);
  }
});

test('cross-tenant incidents are hidden and guard storage errors fail closed', async (t) => {
  const { db: database } = makeDb(); const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'tenant-owner@example.test', 'Owner');
  const other = await register(app, 'tenant-other@example.test', 'Other');
  const workspace = (await owner.post('/api/workspaces').send({ name: 'Tenant' })).body.workspace.id;
  const userId = database.prepare('SELECT id FROM users WHERE email=?').get('tenant-owner@example.test').id;
  seed(database, userId, workspace);
  assert.equal((await other.get('/api/incidents/incident-id-0001/export.pdf')).status, 404);
  database.exec('DROP TABLE memberships'); // Test-only corruption forces workspace-guard fail-closed behavior.
  const denied = await owner.get('/api/incidents/incident-id-0001/export.pdf');
  assert.equal(denied.status, 403); assert.equal(denied.headers['content-type'].startsWith('application/pdf'), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='export'").get().count, 0);
});
