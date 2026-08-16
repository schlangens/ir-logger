const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');

function close(app, db) {
  app.locals.sessionStore.stopCleanup();
  db.close();
}

function withRegistrationClosed(t) {
  process.env.REGISTRATION_OPEN = 'false';
  t.after(() => {
    delete process.env.REGISTRATION_OPEN;
  });
}

test('session reports registration_open true by default (unset REGISTRATION_OPEN)', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app).get('/api/auth/session');
  assert.equal(response.status, 200);
  assert.equal(response.body.registration_open, true);
});

test('session reports registration_open false only for the literal string "false"', async (t) => {
  const { db } = makeDb();
  process.env.REGISTRATION_OPEN = 'FALSE';
  const app = createApp(db, { startSweeper: false });
  t.after(() => {
    close(app, db);
    delete process.env.REGISTRATION_OPEN;
  });
  // Case-sensitive on purpose — anything other than the exact lowercase
  // "false" is treated as open, the safer default for a clone.
  const response = await request(app).get('/api/auth/session');
  assert.equal(response.body.registration_open, true);
});

test('session reports registration_open false when REGISTRATION_OPEN=false', async (t) => {
  const { db } = makeDb();
  withRegistrationClosed(t);
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app).get('/api/auth/session');
  assert.equal(response.status, 200);
  assert.equal(response.body.registration_open, false);
});

test('registration succeeds by default with no REGISTRATION_OPEN set', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email: 'open@example.test', name: 'Open', password: 'long-password' });
  assert.equal(response.status, 201);
});

test('registration is refused with a clear, non-leaking message when closed', async (t) => {
  const { db } = makeDb();
  withRegistrationClosed(t);
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email: 'blocked@example.test', name: 'Blocked', password: 'long-password' });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /not accepting/i);
  assert.match(response.body.error, /demo/i);
  assert.match(response.body.error, /self-host/i);
  assert.equal(
    db.prepare('SELECT id FROM users WHERE email=?').get('blocked@example.test'),
    undefined,
  );
});

test('registration closed does not leak whether an email is already registered', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const openResponse = await request(app)
    .post('/api/auth/register')
    .send({ email: 'exists@example.test', name: 'Exists', password: 'long-password' });
  assert.equal(openResponse.status, 201);
  process.env.REGISTRATION_OPEN = 'false';
  t.after(() => {
    delete process.env.REGISTRATION_OPEN;
  });
  const closedExisting = await request(app)
    .post('/api/auth/register')
    .send({ email: 'exists@example.test', name: 'Exists', password: 'long-password' });
  const closedNew = await request(app)
    .post('/api/auth/register')
    .send({ email: 'brand-new@example.test', name: 'New', password: 'long-password' });
  assert.equal(closedExisting.status, 403);
  assert.equal(closedNew.status, 403);
  assert.equal(closedExisting.body.error, closedNew.body.error);
});

test('existing users can still log in when registration is closed', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const registered = await request(app)
    .post('/api/auth/register')
    .send({ email: 'still-works@example.test', name: 'Still Works', password: 'long-password' });
  assert.equal(registered.status, 201);
  process.env.REGISTRATION_OPEN = 'false';
  t.after(() => {
    delete process.env.REGISTRATION_OPEN;
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'still-works@example.test', password: 'long-password' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, 'still-works@example.test');
});

test('a matching, valid invite lets one new registration through even when closed', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = request.agent(app);
  const ownerRegister = await owner
    .post('/api/auth/register')
    .send({ email: 'owner@example.test', name: 'Owner', password: 'long-password' });
  assert.equal(ownerRegister.status, 201);
  const workspace = await owner.post('/api/workspaces').send({ name: 'IR Team' });
  assert.equal(workspace.status, 201);
  const workspaceId = workspace.body.workspace.id;
  const invite = await owner
    .post(`/api/workspaces/${workspaceId}/invite`)
    .send({ email: 'colleague@example.test', role: 'analyst' });
  assert.equal(invite.status, 201);
  const rawToken = invite.body.invite_url.split('/').pop();

  process.env.REGISTRATION_OPEN = 'false';
  t.after(() => {
    delete process.env.REGISTRATION_OPEN;
  });

  // Without the invite token, a brand-new colleague is still refused.
  const withoutToken = await request(app)
    .post('/api/auth/register')
    .send({ email: 'colleague@example.test', name: 'Colleague', password: 'long-password' });
  assert.equal(withoutToken.status, 403);

  // With the exact invite token and matching email, registration succeeds.
  const colleague = request.agent(app);
  const withToken = await colleague.post('/api/auth/register').send({
    email: 'colleague@example.test',
    name: 'Colleague',
    password: 'long-password',
    invite_token: rawToken,
  });
  assert.equal(withToken.status, 201);

  // The invite itself still needs to be accepted explicitly — registering
  // does not silently grant membership — and, now logged in as that
  // colleague, they can complete the loop the invite link exists for.
  assert.equal(
    db.prepare('SELECT 1 FROM memberships WHERE user_id=? AND workspace_id=?').get(
      db.prepare('SELECT id FROM users WHERE email=?').get('colleague@example.test').id,
      workspaceId,
    ),
    undefined,
  );
  const accepted = await colleague.post(`/api/invites/${rawToken}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.workspace.role, 'analyst');
});

test('an invite token for a different email does not bypass a closed instance', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = request.agent(app);
  await owner
    .post('/api/auth/register')
    .send({ email: 'owner2@example.test', name: 'Owner', password: 'long-password' });
  const workspaceId = (await owner.post('/api/workspaces').send({ name: 'Team' })).body.workspace
    .id;
  const invite = await owner
    .post(`/api/workspaces/${workspaceId}/invite`)
    .send({ email: 'invited-real@example.test', role: 'viewer' });
  const rawToken = invite.body.invite_url.split('/').pop();

  process.env.REGISTRATION_OPEN = 'false';
  t.after(() => {
    delete process.env.REGISTRATION_OPEN;
  });

  const response = await request(app).post('/api/auth/register').send({
    email: 'attacker@example.test',
    name: 'Attacker',
    password: 'long-password',
    invite_token: rawToken,
  });
  assert.equal(response.status, 403);
});

test('an expired or already-accepted invite does not bypass a closed instance', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = request.agent(app);
  await owner
    .post('/api/auth/register')
    .send({ email: 'owner3@example.test', name: 'Owner', password: 'long-password' });
  const workspaceId = (await owner.post('/api/workspaces').send({ name: 'Team' })).body.workspace
    .id;
  const expiredToken = 'expired-raw-token';
  db.prepare(
    'INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'expired-invite',
    workspaceId,
    'expired@example.test',
    'viewer',
    crypto.createHash('sha256').update(expiredToken).digest('hex'),
    db.prepare('SELECT id FROM users WHERE email=?').get('owner3@example.test').id,
    new Date(Date.now() - 1000).toISOString(),
  );

  process.env.REGISTRATION_OPEN = 'false';
  t.after(() => {
    delete process.env.REGISTRATION_OPEN;
  });

  const response = await request(app).post('/api/auth/register').send({
    email: 'expired@example.test',
    name: 'Expired',
    password: 'long-password',
    invite_token: expiredToken,
  });
  assert.equal(response.status, 403);
});

test('GET /downloads/ir-logger.py serves the real desktop tool as a forced download', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app).get('/downloads/ir-logger.py');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.equal(response.headers['content-disposition'], 'attachment; filename="ir-logger.py"');
  const onDisk = fs.readFileSync(path.join(__dirname, '../../ir-logger.py'), 'utf8');
  // application/octet-stream isn't auto-parsed as text by supertest/superagent
  // (unlike text/*), so the body comes back as a raw Buffer — this asserts
  // it's the real file's actual bytes, not just a 200 with some body.
  assert.equal(Buffer.isBuffer(response.body), true);
  assert.equal(response.body.toString('utf8'), onDisk);
});
