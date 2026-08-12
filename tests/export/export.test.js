const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { db: makeDb } = require('../foundation/helpers');
const { createApp } = require('../../src/server');
const payloads = require('../fixtures/markdown-xss-payloads');
const { renderMarkdown } = require('../../src/services/markdown-render');
const {
  getPdfCodeLineText,
  getPdfRunText,
} = require('../../src/services/export-pdf');

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

function seedIncident(database, ownerId, workspaceId, body = 'Evidence observed') {
  database
    .prepare(
      'INSERT INTO incidents (id,workspace_id,ref,title,summary,severity,created_by) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      'incident-id-0001',
      workspaceId,
      'IR-2025-001',
      'Phishing investigation',
      'Full report',
      'high',
      ownerId,
    );
  database
    .prepare(
      'INSERT INTO entries (id,incident_id,kind,occurred_at,body_md,author_user_id) VALUES (?,?,?,?,?,?)',
    )
    .run(
      'entry-id-0001',
      'incident-id-0001',
      'technical',
      '2025-01-02T00:00:00.000Z',
      body,
      ownerId,
    );
  database
    .prepare('INSERT INTO entry_techniques (entry_id,technique_id) VALUES (?,?)')
    .run('entry-id-0001', 'T1566.001');
}

test('exports include report content, metadata, and audit rows', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'export-owner@example.test', 'Owner');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Exports' })
  ).body.workspace.id;
  const ownerId = userId(database, 'export-owner@example.test');
  seedIncident(database, ownerId, workspace);
  database
    .prepare(
      'INSERT INTO entries (id,incident_id,kind,occurred_at,body_md,author_user_id) VALUES (?,?,?,?,?,?)',
    )
    .run(
      'entry-id-0002',
      'incident-id-0001',
      'note',
      '2025-01-01T00:00:00.000Z',
      'Earlier entry',
      ownerId,
    );
  database
    .prepare(
      'INSERT INTO evidence (id,incident_id,filename,mime,size,sha256,stored_path,uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'evidence-id-0001',
      'incident-id-0001',
      'capture.pcap',
      'application/octet-stream',
      1234,
      'a'.repeat(64),
      '/tmp/not-read',
      ownerId,
    );
  const pdf = await owner.get('/api/incidents/incident-id-0001/export.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.headers['content-disposition'], /^attachment;/);
  const markdown = await owner.get('/api/incidents/incident-id-0001/export.md');
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers['content-type'], /^text\/markdown; charset=utf-8/);
  assert.match(markdown.headers['content-disposition'], /^attachment;/);
  assert.match(markdown.text, /IR-2025-001/);
  assert.match(markdown.text, /Evidence observed/);
  assert.match(markdown.text, /Earlier entry/);
  assert.match(markdown.text, /T1566\.001/);
  assert.match(markdown.text, /capture\.pcap/);
  assert.match(markdown.text, /1234/);
  assert.match(markdown.text, new RegExp('a'.repeat(64)));
  assert.match(markdown.text, /Owner/);
  assert.match(markdown.text, /\| Tactic \| ID \| Name \| Count \|/);
  assert.ok(markdown.text.indexOf('Earlier entry') < markdown.text.indexOf('Evidence observed'));
  const rows = database
    .prepare("SELECT action,target_id FROM audit_log WHERE action='export'")
    .all();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.target_id),
    ['incident-id-0001', 'incident-id-0001'],
  );
});

test('exports require membership, including analyst and viewer members', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'member-owner@example.test', 'Owner');
  const analyst = await register(app, 'member-analyst@example.test', 'Analyst');
  const viewer = await register(app, 'member-viewer@example.test', 'Viewer');
  const other = await register(app, 'member-other@example.test', 'Other');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Members' })
  ).body.workspace.id;
  const ownerId = userId(database, 'member-owner@example.test');
  seedIncident(database, ownerId, workspace);
  for (const [email, role] of [
    ['member-analyst@example.test', 'analyst'],
    ['member-viewer@example.test', 'viewer'],
  ]) {
    database
      .prepare('INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)')
      .run(userId(database, email), workspace, role);
  }
  for (const agent of [analyst, viewer]) {
    assert.equal((await agent.get('/api/incidents/incident-id-0001/export.pdf')).status, 200);
    assert.equal((await agent.get('/api/incidents/incident-id-0001/export.md')).status, 200);
  }
  assert.equal((await other.get('/api/incidents/incident-id-0001/export.pdf')).status, 404);
  assert.equal((await request(app).get('/api/incidents/incident-id-0001/export.pdf')).status, 401);
  assert.equal((await request(app).get('/api/incidents/incident-id-0001/export.md')).status, 401);
  assert.equal((await owner.get('/api/incidents/does-not-exist/export.pdf')).status, 404);
  assert.equal((await owner.get('/api/incidents/does-not-exist/export.md')).status, 404);
});

test('Markdown payloads are escaped and invalid links are not active', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'xss-owner@example.test', 'Owner');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'XSS' })
  ).body.workspace.id;
  const ownerId = userId(database, 'xss-owner@example.test');
  for (const payload of payloads) {
    const tokens = renderMarkdown(payload.input);
    assert.ok(Array.isArray(tokens));
    assert.equal(
      tokens.flatMap((block) => block.inlines || []).some((run) => run.type === 'link'),
      false,
      `${payload.name}: renderer produced an active link`,
    );
    const incidentId = `incident-${payload.name}`;
    database
      .prepare(
        'INSERT INTO incidents (id,workspace_id,ref,title,summary,severity,created_by) VALUES (?,?,?,?,?,?,?)',
      )
      .run(incidentId, workspace, `IR-${payload.name}`, 'XSS', '', 'low', ownerId);
    database
      .prepare(
        'INSERT INTO entries (id,incident_id,kind,occurred_at,body_md,author_user_id) VALUES (?,?,?,?,?,?)',
      )
      .run(
        `entry-${payload.name}`,
        incidentId,
        'note',
        '2025-01-01T00:00:00.000Z',
        payload.input,
        ownerId,
      );
    const markdown = await owner.get(
      `/api/incidents/${encodeURIComponent(incidentId)}/export.md`,
    );
    assert.equal(markdown.status, 200);
    for (const forbidden of payload.mustNotContain) {
      assert.equal(markdown.text.includes(forbidden), false, `${payload.name}: markdown`);
    }
    assert.equal(
      (await owner.get(`/api/incidents/${encodeURIComponent(incidentId)}/export.pdf`)).status,
      200,
    );
  }
});

test('legitimate Markdown remains intact and structured', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'legitimate-owner@example.test', 'Owner');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Legitimate' })
  ).body.workspace.id;
  const body = [
    'x < 5 and y = 3',
    '[text](https://example.com/a?b=1&c=2)',
    '**bold** `code`',
    '> not a quote',
    '',
    '```',
    'fenced < &',
    '```',
    '',
    '- bullet',
  ].join('\n');
  const ownerId = userId(database, 'legitimate-owner@example.test');
  seedIncident(database, ownerId, workspace, body);
  const tokens = renderMarkdown(body);
  assert.deepEqual(
    tokens.map((token) => token.type),
    ['paragraph', 'code', 'list'],
  );
  assert.equal(tokens[0].inlines.some((run) => run.type === 'link'), true);
  assert.equal(tokens[0].inlines.some((run) => run.type === 'bold'), true);
  assert.equal(tokens[0].inlines.some((run) => run.type === 'code'), true);
  const markdown = await owner.get('/api/incidents/incident-id-0001/export.md');
  assert.equal(markdown.status, 200);
  assert.match(markdown.text, /x < 5 and y = 3/);
  assert.match(markdown.text, /\[text\]\(https:\/\/example\.com\/a\?b=1&c=2\)/);
  assert.match(markdown.text, /\\> not a quote/);
  assert.match(markdown.text, /fenced < &/);
  assert.doesNotMatch(markdown.text, /&#61;|&#58;|&lt;/);
});

test('PDF drawing text decodes renderer entities', () => {
  const body = "don't cross A & B <tag>";
  const runs = renderMarkdown(body)[0].inlines;
  const drawn = runs.map(getPdfRunText).join('');
  assert.equal(drawn, body);
  assert.doesNotMatch(drawn, /&#39;|&amp;|&lt;/);
});

test('PDF code drawing text decodes renderer entities', () => {
  const body = "curl -s 'https://evil.test/x?a=1&b=2' <tag> # don't run this";
  const block = renderMarkdown(`\`\`\`\n${body}\n\`\`\``)[0];
  const drawn = getPdfCodeLineText(block.text);
  assert.equal(drawn, `    ${body}`);
  assert.doesNotMatch(drawn, /&#39;|&amp;|&lt;/);
});

test('workspace guard failures deny exports before writing audit rows', async (t) => {
  const { db: database } = makeDb();
  const app = createApp(database, { startSweeper: false });
  t.after(() => close(app, database));
  const owner = await register(app, 'guard-export@example.test', 'Owner');
  const workspace = (
    await owner.post('/api/workspaces').send({ name: 'Guard' })
  ).body.workspace.id;
  const ownerId = userId(database, 'guard-export@example.test');
  seedIncident(database, ownerId, workspace);
  database.exec('DROP TABLE memberships'); // Test-only corruption forces workspace-guard fail-closed behavior.
  for (const suffix of ['export.pdf', 'export.md']) {
    const response = await owner.get(`/api/incidents/incident-id-0001/${suffix}`);
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'Unable to resolve workspace access');
    assert.equal(response.headers['content-disposition'], undefined);
  }
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='export'").get().count,
    0,
  );
});
