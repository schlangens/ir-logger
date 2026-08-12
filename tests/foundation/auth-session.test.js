const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');

function sidFromCookie(cookie) {
  return cookie.match(/connect\.sid=s%3A([^\.]+)\./)[1];
}

function signedCookie(sid) {
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=s%3A${encodeURIComponent(sid)}.${signature}`;
}

function close(app, db) {
  app.locals.sessionStore.stopCleanup();
  db.close();
}

test('registration regenerates a genuine pre-existing session', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const oldSid = 'pre-register-session';
  db.prepare('INSERT INTO sessions (sid, session_json, expires_at) VALUES (?, ?, ?)').run(
    oldSid,
    JSON.stringify({
      cookie: { originalMaxAge: null },
      demoWorkspaceId: 'not-used',
    }),
    Date.now() + 60000,
  );
  const response = await request(app)
    .post('/api/auth/register')
    .set('Cookie', signedCookie(oldSid))
    .send({
      email: 'register@example.test',
      name: 'Register',
      password: 'long-password',
    });
  assert.equal(response.status, 201);
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
  const newSid = sidFromCookie(response.headers['set-cookie'][0]);
  assert.notEqual(newSid, oldSid);
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE sid = ?').get(oldSid), undefined);
  assert.equal(
    db
      .prepare('SELECT session_json FROM sessions WHERE sid = ?')
      .get(newSid)
      .session_json.includes('demoWorkspaceId'),
    false,
  );
});

test('login regenerates and drops demoWorkspaceId from a crafted session', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  await request(app).post('/api/auth/register').send({
    email: 'login@example.test',
    name: 'Login',
    password: 'long-password',
  });
  const oldSid = 'pre-login-session';
  db.prepare('INSERT INTO sessions (sid, session_json, expires_at) VALUES (?, ?, ?)').run(
    oldSid,
    JSON.stringify({
      cookie: { originalMaxAge: null },
      demoWorkspaceId: 'demo',
    }),
    Date.now() + 60000,
  );
  const response = await request(app)
    .post('/api/auth/login')
    .set('Cookie', signedCookie(oldSid))
    .send({ email: 'login@example.test', password: 'long-password' });
  assert.equal(response.status, 200);
  const newSid = sidFromCookie(response.headers['set-cookie'][0]);
  assert.notEqual(newSid, oldSid);
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE sid = ?').get(oldSid), undefined);
  const stored = JSON.parse(
    db.prepare('SELECT session_json FROM sessions WHERE sid = ?').get(newSid).session_json,
  );
  assert.equal(Object.hasOwn(stored, 'demoWorkspaceId'), false);
});

test('failed login limiter returns 429 on the eleventh attempt', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  for (let i = 0; i < 10; i++) {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.test', password: 'wrong-password' });
    assert.equal(response.status, 401);
  }
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@example.test', password: 'wrong-password' });
  assert.equal(response.status, 429);
});

test('login limiter storage failure returns 503', async (t) => {
  const { db } = makeDb();
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('rate_limits')) throw new Error('rate limiter unavailable');
    return original(sql);
  };
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@example.test', password: 'wrong-password' });
  assert.equal(response.status, 503);
});

test('registration limiter returns 429 on the sixth attempt', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  for (let i = 0; i < 5; i++) {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: `limited-${i}@example.test`,
        name: 'Limited',
        password: 'long-password',
      });
    assert.equal(response.status, 201);
  }
  const response = await request(app).post('/api/auth/register').send({
    email: 'limited-sixth@example.test',
    name: 'Limited',
    password: 'long-password',
  });
  assert.equal(response.status, 429);
});

test('registration limiter storage failure returns 503', async (t) => {
  const { db } = makeDb();
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('rate_limits')) throw new Error('rate limiter unavailable');
    return original(sql);
  };
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app).post('/api/auth/register').send({
    email: 'failure@example.test',
    name: 'Failure',
    password: 'long-password',
  });
  assert.equal(response.status, 503);
});
