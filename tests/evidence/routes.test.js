const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-evidence-'));
process.env.EVIDENCE_DIR = evidenceDir;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'evidence-test-secret';

const { db: makeDb } = require('../foundation/helpers');
const { createApp } = require('../../src/server');
const hub = require('../../src/sse/hub');

function close(app, db) {
  app.locals.sessionStore.stopCleanup();
  db.close();
}

async function register(app, email, name = 'User') {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .send({ email, name, password: 'long-password' });
  assert.equal(response.status, 201);
  return { agent, id: response.body.user.id };
}

async function setup({ demo = false, role = 'owner' } = {}) {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  const owner = await register(app, `owner-${Date.now()}-${Math.random()}@example.test`, 'Owner');
  const workspaceId = `workspace-${Math.random()}`;
  db.prepare('INSERT INTO workspaces (id,name,is_demo) VALUES (?,?,?)').run(
    workspaceId,
    'Workspace',
    demo ? 1 : 0,
  );
  db.prepare('INSERT INTO memberships (user_id,workspace_id,role) VALUES (?,?,?)').run(
    owner.id,
    workspaceId,
    role,
  );
  const incidentId = `incident-${Math.random()}`;
  // Test fixture: Round 2a incidents routes are not present on this branch.
  db.prepare(
    'INSERT INTO incidents (id,workspace_id,ref,title,severity,created_by) VALUES (?,?,?,?,?,?)',
  ).run(incidentId, workspaceId, 'IR-TEST-' + Math.floor(Math.random() * 100000), 'Incident', 'low', owner.id);
  return { app, db, owner: owner.agent, ownerId: owner.id, workspaceId, incidentId };
}

function fixtureBytes(text = 'forensic evidence fixture') {
  return Buffer.from(text);
}

function insertFixture(db, { id, incidentId, userId, size = 1, storedPath, filename = 'fixture.txt' }) {
  db.prepare(
    `INSERT INTO evidence
      (id,incident_id,filename,mime,size,sha256,stored_path,uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    incidentId,
    filename,
    'text/plain',
    size,
    crypto.createHash('sha256').update('fixture').digest('hex'),
    storedPath || path.join(evidenceDir, `${id}.bin`),
    userId,
  );
}

test('uploads evidence with a single-pass hash and broadcasts metadata', async (t) => {
  const fixture = fixtureBytes();
  const { app, db, owner, ownerId, incidentId } = await setup();
  t.after(() => close(app, db));
  const broadcasts = [];
  const originalBroadcast = hub.broadcast;
  hub.broadcast = (...args) => broadcasts.push(args);
  t.after(() => {
    hub.broadcast = originalBroadcast;
  });

  const response = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixture, { filename: 'notes.txt', contentType: 'text/plain' });
  assert.equal(response.status, 201);
  assert.equal(
    response.body.evidence.sha256,
    crypto.createHash('sha256').update(fixture).digest('hex'),
  );
  assert.equal(response.body.evidence.stored_path, undefined);
  const row = db.prepare('SELECT * FROM evidence WHERE id=?').get(response.body.evidence.id);
  assert.equal(row.uploaded_by, ownerId);
  assert.equal(fs.readFileSync(row.stored_path).toString(), fixture.toString());
  assert.deepEqual(broadcasts, [
    [incidentId, 'evidence.uploaded', response.body.evidence],
  ]);
  assert.equal(
    db
      .prepare("SELECT action FROM custody_events WHERE evidence_id=?")
      .get(row.id).action,
    'uploaded',
  );
});

test('rejects an over-cap file and removes any partial file', async (t) => {
  const { app, db, owner, incidentId } = await setup();
  t.after(() => close(app, db));
  const before = fs.readdirSync(evidenceDir).sort();
  const response = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', Buffer.alloc(25 * 1024 * 1024 + 1), 'too-large.bin');
  assert.equal(response.status, 413);
  assert.deepEqual(fs.readdirSync(evidenceDir).sort(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 0);
});

test('rejects a demo over-cap file and removes any partial file', async (t) => {
  const { app, db, owner, incidentId } = await setup({ demo: true });
  t.after(() => close(app, db));
  const before = fs.readdirSync(evidenceDir).sort();
  const response = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'demo-too-large.bin');
  assert.equal(response.status, 413);
  assert.deepEqual(fs.readdirSync(evidenceDir).sort(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 0);
});

test('demo evidence row cap rejects a sixth upload before writing', async (t) => {
  const { app, db, owner, ownerId, incidentId } = await setup({ demo: true });
  t.after(() => close(app, db));
  for (let i = 0; i < 5; i++)
    insertFixture(db, { id: `demo-${i}`, incidentId, userId: ownerId });
  const before = fs.readdirSync(evidenceDir).sort();
  const response = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixtureBytes(), 'sixth.txt');
  assert.equal(response.status, 409);
  assert.deepEqual(fs.readdirSync(evidenceDir).sort(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 5);
});

test('workspace total-byte cap rejects a new upload', async (t) => {
  const { app, db, owner, ownerId, incidentId } = await setup();
  t.after(() => close(app, db));
  insertFixture(db, { id: 'at-cap', incidentId, userId: ownerId, size: 200 * 1024 * 1024 });
  const before = fs.readdirSync(evidenceDir).sort();
  const response = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixtureBytes(), 'over-total.txt');
  assert.equal(response.status, 409);
  assert.deepEqual(fs.readdirSync(evidenceDir).sort(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 1);
});

test('download is octet-stream for an uploaded image/png file', async (t) => {
  const fixture = fixtureBytes('download me');
  const { app, db, owner, incidentId } = await setup();
  t.after(() => close(app, db));
  const upload = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixture, { filename: 'shot.png', contentType: 'image/png' });
  assert.equal(upload.status, 201);
  const evidenceId = upload.body.evidence.id;
  assert.equal(
    db.prepare('SELECT mime FROM evidence WHERE id=?').get(evidenceId).mime,
    'image/png',
  );
  const response = await owner.get(`/api/evidence/${evidenceId}/download`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.match(response.headers['content-disposition'], /^attachment; filename="[^"]+"$/);
  assert.match(response.headers['content-disposition'], /attachment; filename="shot\.png"/);
  assert.equal(response.body.toString(), fixture.toString());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM custody_events WHERE action=?').get('downloaded').count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='evidence.downloaded'").get().count, 1);
});

test('sanitizes uploaded filenames and stores files under generated names', async (t) => {
  const fixture = fixtureBytes('sanitized filename');
  const { app, db, owner, incidentId } = await setup();
  t.after(() => close(app, db));
  const upload = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixture, { filename: '../../etc/passwd', contentType: 'text/plain' });
  assert.equal(upload.status, 201);
  const evidenceId = upload.body.evidence.id;
  const row = db.prepare('SELECT filename,stored_path FROM evidence WHERE id=?').get(evidenceId);
  // Multer strips the path components before the route receives originalname.
  assert.equal(row.filename, 'passwd');
  assert.equal(row.stored_path.startsWith(`${evidenceDir}${path.sep}`), true);
  assert.equal(path.basename(row.stored_path).match(/^[A-Za-z0-9_-]{24}\.bin$/) !== null, true);
  assert.equal(row.stored_path.includes('../../etc/passwd'), false);
  assert.equal(row.stored_path.includes('passwd'), false);
  assert.equal(row.stored_path.includes('etc'), false);
  assert.equal(row.stored_path.includes('..'), false);
  assert.equal(row.stored_path.includes('/etc/'), false);
  assert.equal(row.stored_path.includes('\\'), false);
  assert.equal(row.filename.includes('/'), false);
  assert.equal(row.filename.includes('\\'), false);
  assert.equal(
    upload.body.evidence.filename,
    row.filename,
  );
  const download = await owner.get(`/api/evidence/${evidenceId}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-disposition'].includes('/'), false);
  assert.equal(download.headers['content-disposition'].includes('\\'), false);
  assert.match(download.headers['content-disposition'], /filename="passwd"/);
});

test('metadata view and list omit stored_path and append paired custody/audit rows', async (t) => {
  const fixture = fixtureBytes();
  const { app, db, owner, ownerId, incidentId } = await setup();
  t.after(() => close(app, db));
  const storedPath = path.join(evidenceDir, 'metadata.bin');
  fs.writeFileSync(storedPath, fixture);
  insertFixture(db, { id: 'metadata-evidence', incidentId, userId: ownerId, storedPath });
  const view = await owner.get('/api/evidence/metadata-evidence');
  assert.equal(view.status, 200);
  assert.equal(view.body.evidence.stored_path, undefined);
  const list = await owner.get(`/api/incidents/${incidentId}/evidence`);
  assert.equal(list.status, 200);
  assert.equal(list.body.evidence.length, 1);
  assert.equal(list.body.evidence[0].stored_path, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM custody_events WHERE action='viewed'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='evidence.viewed'").get().count, 1);
});

test('custody returns events oldest-first', async (t) => {
  const { app, db, owner, ownerId, incidentId } = await setup();
  t.after(() => close(app, db));
  insertFixture(db, { id: 'trail-evidence', incidentId, userId: ownerId });
  db.prepare(
    'INSERT INTO custody_events (id,evidence_id,action,actor_user_id,at) VALUES (?,?,?,?,?)',
  ).run('trail-uploaded', 'trail-evidence', 'uploaded', ownerId, '2020-01-01T00:00:00.000Z');
  db.prepare(
    'INSERT INTO custody_events (id,evidence_id,action,actor_user_id,at) VALUES (?,?,?,?,?)',
  ).run('trail-viewed', 'trail-evidence', 'viewed', ownerId, '2021-01-01T00:00:00.000Z');
  const response = await owner.get('/api/evidence/trail-evidence/custody');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events.map((event) => event.id), ['trail-uploaded', 'trail-viewed']);
});

test('viewer cannot upload evidence', async (t) => {
  const { app, db, owner, incidentId, workspaceId } = await setup();
  t.after(() => close(app, db));
  const viewer = await register(app, `viewer-${Date.now()}@example.test`, 'Viewer');
  db.prepare('INSERT INTO memberships (user_id,workspace_id,role) VALUES (?,?,?)').run(
    viewer.id,
    workspaceId,
    'viewer',
  );
  const response = await viewer.agent
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixtureBytes(), 'blocked.txt');
  assert.equal(response.status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 0);
});

test('upload rolls back evidence and custody when audit insertion fails', async (t) => {
  const { app, db, owner, incidentId } = await setup();
  t.after(() => close(app, db));
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('INSERT INTO audit_log')) throw new Error('audit unavailable');
    return originalPrepare(sql);
  };
  const response = await owner
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', fixtureBytes(), 'rollback.txt');
  db.prepare = originalPrepare;
  assert.equal(response.status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM evidence').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM custody_events').get().count, 0);
});

async function crossTenantSetup() {
  const first = await setup();
  const second = await register(
    first.app,
    `cross-tenant-${Date.now()}-${Math.random()}@example.test`,
    'Other tenant user',
  );
  const secondWorkspaceId = `workspace-${Math.random()}`;
  first.db
    .prepare('INSERT INTO workspaces (id,name,is_demo) VALUES (?,?,0)')
    .run(secondWorkspaceId, 'Other workspace');
  first.db
    .prepare('INSERT INTO memberships (user_id,workspace_id,role) VALUES (?,?,?)')
    .run(second.id, secondWorkspaceId, 'owner');
  const secondIncidentId = `incident-${Math.random()}`;
  // Test fixture: Round 2a incidents routes are not present on this branch.
  first.db
    .prepare(
      'INSERT INTO incidents (id,workspace_id,ref,title,severity,created_by) VALUES (?,?,?,?,?,?)',
    )
    .run(
      secondIncidentId,
      secondWorkspaceId,
      'IR-TEST-' + Math.floor(Math.random() * 100000),
      'Other incident',
      'low',
      second.id,
    );
  const storedPath = path.join(evidenceDir, `cross-${Math.random()}.bin`);
  fs.writeFileSync(storedPath, 'cross tenant');
  insertFixture(first.db, {
    id: 'cross-tenant-evidence',
    incidentId: first.incidentId,
    userId: first.ownerId,
    storedPath,
  });
  return { first, second: { owner: second.agent } };
}

test('bare evidence metadata route returns 404 across tenants', async (t) => {
  const { first, second } = await crossTenantSetup();
  t.after(() => close(first.app, first.db));
  assert.equal((await second.owner.get('/api/evidence/cross-tenant-evidence')).status, 404);
});

test('bare evidence download route returns 404 across tenants', async (t) => {
  const { first, second } = await crossTenantSetup();
  t.after(() => close(first.app, first.db));
  assert.equal((await second.owner.get('/api/evidence/cross-tenant-evidence/download')).status, 404);
});

test('bare evidence custody route returns 404 across tenants', async (t) => {
  const { first, second } = await crossTenantSetup();
  t.after(() => close(first.app, first.db));
  assert.equal((await second.owner.get('/api/evidence/cross-tenant-evidence/custody')).status, 404);
});
