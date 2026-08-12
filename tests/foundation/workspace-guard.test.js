const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');
const { resolveWorkspaceAccess, resolveActor } = require('../../src/middleware/workspace-guard');

function signedCookie(sid) {
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=s%3A${encodeURIComponent(sid)}.${signature}`;
}

test('a registered user cannot access another tenant', async (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const app = createApp(db, { startSweeper: false });
  const registration = await request(app).post('/api/auth/register').send({
    email: 'member@example.test',
    name: 'Member',
    password: 'long-password',
  });
  const user = registration.body.user;
  db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run('other', 'Other');
  const result = resolveWorkspaceAccess(db, { user, session: {} }, 'other');
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('a matching demo session gets owner-equivalent access', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)').run(
    'demo',
    'Demo',
    new Date(Date.now() + 60000).toISOString(),
  );
  assert.deepEqual(resolveWorkspaceAccess(db, { session: { demoWorkspaceId: 'demo' } }, 'demo'), {
    ok: true,
    role: 'owner',
    isDemo: true,
  });
});

test('workspace lookup errors deny access without throwing', () => {
  const db = {
    prepare() {
      throw new Error('storage failure');
    },
  };
  const result = resolveWorkspaceAccess(db, { user: { id: 'u' }, session: {} }, 'w');
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('real memberships report demo status', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)').run(
    'demo',
    'Demo',
    new Date(Date.now() + 60000).toISOString(),
  );
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    'u',
    'u@example.test',
    'U',
    'hash',
  );
  db.prepare('INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)').run(
    'u',
    'demo',
    'viewer',
  );
  assert.deepEqual(resolveWorkspaceAccess(db, { user: { id: 'u' }, session: {} }, 'demo'), {
    ok: true,
    role: 'viewer',
    isDemo: true,
  });
});

test('demo-only sessions cannot create user workspaces', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => {
    app.locals.sessionStore.stopCleanup();
    db.close();
  });
  const sid = 'demo-only-session';
  db.prepare('INSERT INTO sessions (sid, session_json, expires_at) VALUES (?, ?, ?)').run(
    sid,
    JSON.stringify({ cookie: { originalMaxAge: null }, demoWorkspaceId: 'demo' }),
    Date.now() + 60000,
  );
  const response = await request(app)
    .post('/api/workspaces')
    .set('Cookie', signedCookie(sid))
    .send({ name: 'Should fail' });
  assert.equal(response.status, 401);
  assert.equal(
    (
      await request(app)
        .post('/api/workspaces/demo/invite')
        .set('Cookie', signedCookie(sid))
        .send({ email: 'nobody@example.test', role: 'viewer' })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post('/api/workspaces/demo/tokens')
        .set('Cookie', signedCookie(sid))
        .send({ name: 'Should fail' })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .delete('/api/workspaces/demo/tokens/token')
        .set('Cookie', signedCookie(sid))
    ).status,
    401,
  );
});

test('resolveActor returns the real user id when a real user is present', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  assert.deepEqual(resolveActor(db, { user: { id: 'real-user' }, session: {} }, 'any'), { id: 'real-user' });
});

test('resolveActor resolves a demo session to its synthetic user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)').run(
    'demo-ws',
    'Demo',
    new Date(Date.now() + 60000).toISOString(),
  );
  db.prepare('INSERT INTO users (id, email, name, is_demo) VALUES (?, ?, ?, 1)').run(
    'demo-user',
    'demo-demo-ws@demo.invalid',
    'Demo visitor',
  );
  assert.deepEqual(
    resolveActor(db, { user: undefined, session: { demoWorkspaceId: 'demo-ws', demoUserId: 'demo-user' } }, 'demo-ws'),
    { id: 'demo-user' },
  );
});

test('resolveActor returns null when no actor can be resolved', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  assert.equal(resolveActor(db, { user: undefined, session: {} }, 'missing'), null);
  db.prepare('INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)').run(
    'demo-ws',
    'Demo',
    new Date(Date.now() + 60000).toISOString(),
  );
  assert.equal(
    resolveActor(db, { user: undefined, session: { demoWorkspaceId: 'other-ws' } }, 'demo-ws'),
    null,
  );
});

test('demo actor cannot access a real workspace via requireWorkspace', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => {
    app.locals.sessionStore.stopCleanup();
    db.close();
  });

  db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run('real-ws', 'Real');
  db.prepare('INSERT INTO users (id, email, name, is_demo) VALUES (?, ?, ?, 1)').run(
    'demo-user',
    'demo-demo-ws@demo.invalid',
    'Demo visitor',
  );

  const sid = 'demo-isolated';
  db.prepare('INSERT INTO sessions (sid, session_json, expires_at) VALUES (?, ?, ?)').run(
    sid,
    JSON.stringify({ cookie: { originalMaxAge: null }, demoWorkspaceId: 'demo-ws', demoUserId: 'demo-user' }),
    Date.now() + 60000,
  );
  const response = await request(app)
    .get('/api/workspaces/real-ws')
    .set('Cookie', signedCookie(sid));
  assert.equal(response.status, 401);
});
