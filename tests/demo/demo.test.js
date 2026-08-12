const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');
const seedDemoWorkspace = require('../../src/services/demo-seed');
const { sweep } = require('../../src/services/demo-sweeper');
const {
  resolveWorkspaceAccess,
  resolveActor,
} = require('../../src/middleware/workspace-guard');

function appFor(t) {
  const context = makeDb();
  const app = createApp(context.db, { startSweeper: false });
  t.after(() => {
    app.locals.sessionStore.stopCleanup();
    context.db.close();
  });
  return { ...context, app };
}

function sessionId(response) {
  const cookie = response.headers['set-cookie'].find((value) => value.startsWith('connect.sid='));
  return decodeURIComponent(cookie.match(/^connect.sid=s%3A([^.;]+)/)[1]);
}

function demoRequest(agentOrApp) {
  const target = typeof agentOrApp.listen === 'function' ? request(agentOrApp) : agentOrApp;
  return target.post('/api/demo').set('Host', 'localhost').set('Origin', 'http://localhost');
}

function assertWorkspaceRowsAbsent(db, workspaceId) {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id=?').get(workspaceId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE workspace_id=?').get(workspaceId).n, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM entries e JOIN incidents i ON i.id=e.incident_id WHERE i.workspace_id=?').get(workspaceId).n,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM entry_techniques et JOIN entries e ON e.id=et.entry_id JOIN incidents i ON i.id=e.incident_id WHERE i.workspace_id=?').get(workspaceId).n,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM evidence e JOIN incidents i ON i.id=e.incident_id WHERE i.workspace_id=?').get(workspaceId).n,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM custody_events c JOIN evidence e ON e.id=c.evidence_id JOIN incidents i ON i.id=e.incident_id WHERE i.workspace_id=?').get(workspaceId).n,
    0,
  );
  for (const table of ['audit_log', 'api_tokens', 'invites', 'memberships'])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id=?`).get(workspaceId).n, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE email='demo-'||?||'@demo.invalid'").get(workspaceId).n,
    0,
  );
}

test('demo creation seeds the full scenario, evidence, and persisted session grant', async (t) => {
  const { db, app, evidenceDir } = appFor(t);
  const response = await demoRequest(app);
  assert.equal(response.status, 201);
  const { workspaceId, incidentId } = response.body;
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
  assert.equal(workspace.is_demo, 1);
  assert.ok(new Date(workspace.expires_at) > new Date(Date.now() + 23 * 60 * 60 * 1000));
  assert.ok(new Date(workspace.expires_at) < new Date(Date.now() + 25 * 60 * 60 * 1000));
  assert.deepEqual(
    db.prepare('SELECT ref, title, severity, status FROM incidents WHERE id=?').get(incidentId),
    {
      ref: 'IR-DEMO-0001',
      title: 'Suspicious login → lateral movement — Contoso Finance',
      severity: 'high',
      status: 'contained',
    },
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries WHERE incident_id=?').get(incidentId).n, 6);
  const tags = db
    .prepare(
      `SELECT et.technique_id FROM entry_techniques et
       JOIN entries e ON e.id=et.entry_id WHERE e.incident_id=? ORDER BY et.rowid`,
    )
    .all(incidentId)
    .map((row) => row.technique_id);
  assert.deepEqual(tags, ['T1566.001', 'T1204.002', 'T1003.001', 'T1021.001']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM techniques WHERE id IN (?,?,?,?)').get(...tags).n, 4);
  const evidence = db.prepare('SELECT * FROM evidence WHERE incident_id=?').get(incidentId);
  assert.equal(evidence.filename, 'phishing-email-headers.txt');
  assert.equal(evidence.mime, 'text/plain');
  assert.equal(evidence.size, fs.statSync(evidence.stored_path).size);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(evidence.stored_path)).digest('hex'),
    evidence.sha256,
  );
  assert.equal(path.dirname(evidence.stored_path), evidenceDir);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id=?').get(workspaceId).n, 2);
  const sid = sessionId(response);
  const session = db.prepare('SELECT session_json FROM sessions WHERE sid=?').get(sid);
  const sessionData = JSON.parse(session.session_json);
  assert.equal(sessionData.demoWorkspaceId, workspaceId);
  assert.equal(typeof sessionData.demoUserId, 'string');
  assert.equal(
    db.prepare('SELECT is_demo FROM users WHERE id=?').get(sessionData.demoUserId).is_demo,
    1,
  );
  assert.deepEqual(
    resolveWorkspaceAccess(db, { session: sessionData }, workspaceId),
    { ok: true, role: 'owner', isDemo: true },
  );
  assert.deepEqual(resolveActor(db, { session: sessionData }, workspaceId), { id: sessionData.demoUserId });
});

test('demo creation requires a same-origin request', async (t) => {
  const { app } = appFor(t);
  assert.equal((await request(app).post('/api/demo')).status, 403);
  assert.equal(
    (
      await request(app)
        .post('/api/demo')
        .set('Host', 'localhost')
        .set('Origin', 'http://evil.example')
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/demo')
        .set('Host', 'localhost')
        .set('Referer', 'http://evil.example/')
    ).status,
    403,
  );
});

test('demo creation regenerates the session and reuses an existing live grant', async (t) => {
  const { db, app } = appFor(t);
  const agent = request.agent(app);
  const first = await demoRequest(agent);
  assert.equal(first.status, 201);
  const firstSid = sessionId(first);

  const second = await demoRequest(agent);
  assert.equal(second.status, 200);
  assert.equal(second.body.workspaceId, first.body.workspaceId);
  assert.equal(second.body.incidentId, first.body.incidentId);
  const secondSid = sessionId(second);
  assert.notEqual(secondSid, firstSid);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE is_demo=1').get().n, 1);
  assert.equal(
    db.prepare('SELECT session_json FROM sessions WHERE sid=?').get(secondSid).session_json.includes('demoWorkspaceId'),
    true,
  );
});

test('demo creation rate limit and limiter storage failure fail closed', async (t) => {
  const { db, app } = appFor(t);
  for (let i = 0; i < 3; i++) assert.equal((await demoRequest(app)).status, 201);
  assert.equal((await demoRequest(app)).status, 429);
  db.exec('DROP TABLE rate_limits');
  assert.equal(
    (await demoRequest(app).set('X-Forwarded-For', '198.51.100.10')).status,
    503,
  );
});

test('demo global ceiling is exclusive and count failures fail closed', async (t) => {
  const { db, app } = appFor(t);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (let i = 0; i < 24; i++)
    db.prepare('INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)').run(
      `active-${i}`,
      'Active demo',
      future,
    );
  assert.equal(
    (await demoRequest(app).set('X-Forwarded-For', '198.51.100.20')).status,
    201,
  );
  const failure = appFor(t);
  failure.db.exec('DROP TABLE workspaces');
  assert.equal(
    (await demoRequest(failure.app).set('X-Forwarded-For', '198.51.100.21')).status,
    503,
  );
});

test('demo creation rejects a full active global ceiling', async (t) => {
  const { db, app } = appFor(t);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (let i = 0; i < 25; i++)
    db.prepare('INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)').run(
      `full-${i}`,
      'Active demo',
      future,
    );
  const response = await demoRequest(app).set('X-Forwarded-For', '198.51.100.22');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Demo capacity unavailable' });
});

test('sweeper removes all expired workspace rows and its evidence file', (t) => {
  const { db } = appFor(t);
  const seeded = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(sweep(db).swept, 1);
  assert.equal(fs.existsSync(seeded.storedPath), false);
  assertWorkspaceRowsAbsent(db, seeded.workspaceId);
});

test('sweeper treats a pre-deleted evidence file as success', (t) => {
  const { db } = appFor(t);
  const seeded = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  fs.unlinkSync(seeded.storedPath);
  assert.deepEqual(sweep(db), { swept: 1, failed: 0 });
  assertWorkspaceRowsAbsent(db, seeded.workspaceId);
});

test('sweeper isolates a file failure and rolls back only that workspace', (t) => {
  const { db } = appFor(t);
  const first = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 2000).toISOString() });
  const second = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const originalUnlink = fs.unlinkSync;
  fs.unlinkSync = (filePath) => {
    if (filePath === first.storedPath) {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
    return originalUnlink(filePath);
  };
  t.after(() => {
    fs.unlinkSync = originalUnlink;
  });
  assert.deepEqual(sweep(db), { swept: 1, failed: 1 });
  assert.ok(db.prepare('SELECT id FROM workspaces WHERE id=?').get(first.workspaceId));
  assert.ok(db.prepare('SELECT id FROM evidence WHERE id=?').get(first.evidenceId));
  assertWorkspaceRowsAbsent(db, second.workspaceId);
  assert.equal(fs.existsSync(second.storedPath), false);
  assert.equal(fs.existsSync(first.storedPath), true);
});

test('sweeper leaves active demos untouched and reports a no-op', (t) => {
  const { db } = appFor(t);
  const active = seedDemoWorkspace(db);
  assert.deepEqual(sweep(db), { swept: 0, failed: 0 });
  assert.ok(db.prepare('SELECT id FROM workspaces WHERE id=?').get(active.workspaceId));
  assert.ok(fs.existsSync(active.storedPath));
});

test('sweeper skips evidence stored outside the evidence directory', (t) => {
  const { db } = appFor(t);
  const seeded = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const escaped = path.join(os.tmpdir(), 'ir-evidence-escape.bin');
  fs.writeFileSync(escaped, 'escaped evidence file');
  db.prepare('UPDATE evidence SET stored_path=? WHERE id=?').run(escaped, seeded.evidenceId);
  assert.deepEqual(sweep(db), { swept: 1, failed: 0 });
  assertWorkspaceRowsAbsent(db, seeded.workspaceId);
  assert.equal(fs.existsSync(escaped), true);
  fs.unlinkSync(escaped);
});

test('demo visitor can upload evidence and view or download it', async (t) => {
  const { db, app } = appFor(t);
  const agent = request.agent(app);
  const demo = await demoRequest(agent);
  assert.equal(demo.status, 201);
  const { workspaceId, incidentId } = demo.body;
  const userId = db
    .prepare("SELECT id FROM users WHERE email='demo-'||?||'@demo.invalid'")
    .get(workspaceId).id;
  const fixture = Buffer.from('demo visitor evidence');

  const upload = await agent
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixture, 'demo-upload.txt');
  assert.equal(upload.status, 201);
  const evidenceId = upload.body.evidence.id;
  assert.equal(upload.body.evidence.uploaded_by, userId);
  assert.equal(
    db.prepare('SELECT uploaded_by FROM evidence WHERE id=?').get(evidenceId).uploaded_by,
    userId,
  );

  const view = await agent.get(`/api/evidence/${evidenceId}`);
  assert.equal(view.status, 200);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM custody_events WHERE action='viewed' AND evidence_id=?").get(evidenceId).n,
    1,
  );

  const download = await agent.get(`/api/evidence/${evidenceId}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-type'], 'application/octet-stream');
  assert.equal(download.body.toString(), fixture.toString());
});

test('demo actor is confined to its own demo workspace', async (t) => {
  const { db, app } = appFor(t);
  const agent = request.agent(app);
  const demo = await demoRequest(agent);
  assert.equal(demo.status, 201);

  const owner = await request(app).post('/api/auth/register').send({
    email: 'owner-demo-confine@example.test',
    name: 'Owner',
    password: 'long-password',
  });
  assert.equal(owner.status, 201);
  const ownerAgent = request.agent(app);
  const login = await ownerAgent.post('/api/auth/login').send({
    email: 'owner-demo-confine@example.test',
    password: 'long-password',
  });
  assert.equal(login.status, 200);
  const workspace = await ownerAgent.post('/api/workspaces').send({ name: 'Real' });
  assert.equal(workspace.status, 201);
  const realWorkspaceId = workspace.body.workspace.id;
  const realIncidentId = `incident-${Math.random()}`;
  db.prepare(
    'INSERT INTO incidents (id, workspace_id, ref, title, severity, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(realIncidentId, realWorkspaceId, 'IR-REAL-0001', 'Real incident', 'medium', owner.body.user.id);

  assert.equal(
    (await agent.get(`/api/incidents/${realIncidentId}/evidence`)).status,
    401,
  );
  assert.equal(
    (
      await agent
        .post(`/api/incidents/${realIncidentId}/evidence`)
        .attach('file', Buffer.from('x'), 'x.txt')
    ).status,
    401,
  );
});

test('synthetic demo user cannot authenticate by password or Google', async (t) => {
  const { db, app } = appFor(t);
  const demo = await demoRequest(app);
  assert.equal(demo.status, 201);
  const email = `demo-${demo.body.workspaceId}@demo.invalid`;

  const login = await request(app).post('/api/auth/login').send({
    email,
    password: 'not-a-real-password',
  });
  assert.equal(login.status, 401);
});
