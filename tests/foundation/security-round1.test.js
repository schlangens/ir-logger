const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const passport = require('passport');
const bcrypt = require('bcrypt');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');
const { resolveWorkspaceAccess } = require('../../src/middleware/workspace-guard');
const { consume } = require('../../src/middleware/rate-limit');
const audit = require('../../src/services/audit');
const { configurePassport, hashPassword } = require('../../src/auth/passport');
const { createUpload } = require('../../src/uploads/storage');

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
  return agent;
}

function signedCookie(sid) {
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=s%3A${encodeURIComponent(sid)}.${signature}`;
}

// Pins demo provenance FKs with a synthetic demo user.
test('demo-shaped provenance inserts succeed with foreign keys enabled', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO workspaces (id,name,is_demo) VALUES (?,?,1)').run('demo', 'Demo');
  db.prepare(
    'INSERT INTO users (id,email,name,is_demo) VALUES (?,?,?,1)',
  ).run('demo-user', 'demo-demo@demo.invalid', 'Demo visitor');
  db.prepare(
    "INSERT INTO incidents (id,workspace_id,ref,title,severity,created_by) VALUES (?,?,?,?,?,?)",
  ).run('i', 'demo', 'IR-DEMO-0001', 'Seed', 'high', 'demo-user');
  db.prepare(
    `INSERT INTO entries
      (id,incident_id,kind,occurred_at,body_md,author_user_id)
      VALUES (?,?,?,?,?,?)`,
  ).run('e', 'i', 'note', new Date().toISOString(), 'seed', 'demo-user');
  db.prepare(
    `INSERT INTO evidence
      (id,incident_id,filename,mime,size,sha256,stored_path,uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)`,
  ).run('v', 'i', 'seed.txt', 'text/plain', 1, 'hash', '/tmp/seed.txt', 'demo-user');
  db.prepare(
    'INSERT INTO custody_events (id,evidence_id,action,actor_user_id) VALUES (?,?,?,?)',
  ).run('c', 'v', 'uploaded', 'demo-user');
});

// Pins the users credential CHECK for non-demo rows.
test('credential-less non-demo users remain rejected', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  assert.throws(
    () => db.prepare('INSERT INTO users (id,email,name) VALUES (?,?,?)').run('u', 'u@test', 'U'),
    /CHECK constraint failed/,
  );
});

// Pins byte-level parity between the SPEC DDL and migration.
test('SPEC users/incidents/entries/evidence/custody DDL matches migration', () => {
  const spec = fs.readFileSync('SPEC.md', 'utf8');
  const migration = fs.readFileSync('src/db/migrations/001_init.sql', 'utf8');
  for (const table of ['users', 'incidents', 'entries', 'evidence', 'custody_events']) {
    const from = (text) => text.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))[0];
    assert.equal(from(spec), from(migration), table);
  }
});

// Pins audit string canonicalization and explicit required-field errors.
test('audit canonicalizes numeric ids and validates required fields', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO workspaces (id,name) VALUES (?,?)').run('42', 'W');
  db.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)').run(
    '7',
    '7@x',
    'Seven',
    'hash',
  );
  audit.append(db, {
    workspaceId: 42,
    actorUserId: 7,
    action: 9,
    targetType: 'entry',
    targetId: 42,
    payload: {},
  });
  assert.deepEqual(audit.verify(db, 42), { valid: true, checked: 1 });
  assert.throws(
    () => audit.append(db, { workspaceId: '42', action: 'x', targetId: 'id' }),
    (error) =>
      error instanceof Error &&
      /targetType/.test(error.message) &&
      !/SqliteError/.test(error.constructor.name),
  );
  assert.throws(
    () => audit.append(db, { workspaceId: '42', action: 'x', targetType: 'entry' }),
    (error) => error instanceof Error && /targetId/.test(error.message),
  );
});

// Pins atomic login-budget consumption under concurrent authentication.
test('concurrent failed logins consume the shared budget', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  await request(app).post('/api/auth/register').send({
    email: 'concurrent@example.test',
    name: 'Concurrent',
    password: 'long-password',
  });
  const responses = await Promise.all(
    Array.from({ length: 25 }, () =>
      request(app).post('/api/auth/login').send({
        email: 'concurrent@example.test',
        password: 'wrong-password',
      }),
    ),
  );
  assert.ok(responses.some((response) => response.status === 429));
  assert.ok(responses.filter((response) => response.status === 401).length <= 10);
});

// Pins constant-work bcrypt behavior for missing and passwordless users.
test('passport compares a fixed dummy hash for missing and passwordless users', async (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  configurePassport(db);
  const strategy = passport._strategies.local;
  const original = bcrypt.compare;
  let calls = 0;
  bcrypt.compare = async (...args) => {
    calls++;
    return original(...args);
  };
  t.after(() => {
    bcrypt.compare = original;
  });
  await new Promise((resolve, reject) =>
    strategy._verify('missing@x', 'password', (error, user) => {
      try {
        assert.ifError(error);
        assert.equal(user, false);
        resolve();
      } catch (e) {
        reject(e);
      }
    }),
  );
  const fakeDb = {
    prepare() {
      return { get: () => ({ id: 'd', email: 'd@x', name: 'D', password_hash: null }) };
    },
  };
  configurePassport(fakeDb);
  await new Promise((resolve, reject) =>
    passport._strategies.local._verify('d@x', 'password', (error, user) => {
      try {
        assert.ifError(error);
        assert.equal(user, false);
        resolve();
      } catch (e) {
        reject(e);
      }
    }),
  );
  assert.equal(calls, 2);
});

// Pins one case-insensitive email identity across registration and login.
test('email identity is case-insensitive and login accepts either casing', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  assert.equal(
    (await request(app).post('/api/auth/register').send({
      email: 'victim@corp.test',
      name: 'Victim',
      password: 'long-password',
    })).status,
    201,
  );
  const duplicate = await request(app).post('/api/auth/register').send({
    email: 'VICTIM@corp.test',
    name: 'Other',
    password: 'long-password',
  });
  assert.equal(duplicate.status, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  const agent = request.agent(app);
  assert.equal(
    (await agent.post('/api/auth/login').send({
      email: 'VICTIM@CORP.TEST',
      password: 'long-password',
    })).status,
    200,
  );
  assert.equal((await agent.get('/api/auth/session')).body.user.email, 'victim@corp.test');
});

// Pins successful login behavior when a best-effort refund cannot persist.
test('login succeeds when rate-limit refund storage fails', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  await request(app).post('/api/auth/register').send({
    email: 'refund@example.test',
    name: 'Refund',
    password: 'long-password',
  });
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('UPDATE rate_limits SET count=count-1')) {
      throw new Error('refund unavailable');
    }
    return original(sql);
  };
  const response = await request(app).post('/api/auth/login').send({
    email: 'refund@example.test',
    password: 'long-password',
  });
  assert.equal(response.status, 200);
});

// Pins single-attempt refunds against interleaved shared-IP login activity.
test('successful login refunds only its own attempt for the shared IP budget', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  await request(app).post('/api/auth/register').send({
    email: 'victim-budget@example.test',
    name: 'Victim',
    password: 'long-password',
  });
  await request(app).post('/api/auth/register').send({
    email: 'attacker-budget@example.test',
    name: 'Attacker',
    password: 'long-password',
  });
  for (let i = 0; i < 9; i++) {
    assert.equal(
      (
        await request(app).post('/api/auth/login').send({
          email: 'victim-budget@example.test',
          password: 'wrong-password',
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (
      await request(app).post('/api/auth/login').send({
        email: 'attacker-budget@example.test',
        password: 'long-password',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app).post('/api/auth/login').send({
        email: 'victim-budget@example.test',
        password: 'wrong-password',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app).post('/api/auth/login').send({
        email: 'victim-budget@example.test',
        password: 'wrong-password',
      })
    ).status,
    429,
  );
});

// Pins authentication before workspace existence resolution for anonymous callers.
test('anonymous workspace lookups do not reveal workspace existence', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, 'oracle-owner@example.test');
  const id = (await owner.post('/api/workspaces').send({ name: 'Oracle' })).body.workspace.id;
  const real = await request(app).get(`/api/workspaces/${id}`);
  const missing = await request(app).get('/api/workspaces/does-not-exist');
  assert.equal(real.status, missing.status);
  assert.deepEqual(real.body, missing.body);
  for (const header of ['content-type', 'content-length', 'etag', 'x-powered-by']) {
    assert.equal(real.headers[header], missing.headers[header], header);
  }
});

// Pins demo-session access to live, explicitly demo workspaces.
test('demo access requires a live demo workspace', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO workspaces (id,name,is_demo,expires_at) VALUES (?,?,1,?)').run(
    'expired',
    'Expired',
    new Date(Date.now() - 1).toISOString(),
  );
  db.prepare('INSERT INTO workspaces (id,name,is_demo) VALUES (?,?,0)').run('real', 'Real');
  assert.equal(
    resolveWorkspaceAccess(db, { session: { demoWorkspaceId: 'expired' } }, 'expired').ok,
    false,
  );
  assert.equal(
    resolveWorkspaceAccess(db, { session: { demoWorkspaceId: 'real' } }, 'real').ok,
    false,
  );
});

// Pins authentication on the owner-only token listing route.
test('demo session cannot list workspace tokens', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  db.prepare('INSERT INTO workspaces (id,name,is_demo,expires_at) VALUES (?,?,1,?)').run(
    'demo', 'Demo', new Date(Date.now() + 60000).toISOString(),
  );
  const sid = 'demo-token-session';
  db.prepare('INSERT INTO sessions (sid,session_json,expires_at) VALUES (?,?,?)').run(
    sid,
    JSON.stringify({ cookie: { originalMaxAge: null }, demoWorkspaceId: 'demo' }),
    Date.now() + 60000,
  );
  const response = await request(app)
    .get('/api/workspaces/demo/tokens')
    .set('Cookie', signedCookie(sid));
  assert.equal(response.status, 401);
  assert.equal(response.body.tokens, undefined);
});

// Pins fail-closed propagation of workspace-list storage failures.
test('workspace list propagates storage failures', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const agent = await register(app, 'list-error@example.test');
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('FROM memberships m JOIN workspaces')) throw new Error('storage');
    return original(sql);
  };
  const response = await agent.get('/api/workspaces');
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Internal server error');
});

// Pins JSON parser errors, body limits, and auth field types.
test('JSON boundaries reject oversized, malformed, and object values', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const oversized = await request(app)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ email: 'x@x', name: 'x', password: 'x'.repeat(200000) }));
  assert.equal(oversized.status, 413);
  const malformed = await request(app)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .send('{"email":');
  assert.equal(malformed.status, 400);
  for (const path of ['/api/auth/register', '/api/auth/login']) {
    const response = await request(app)
      .post(path)
      .send({ email: { a: 1 }, password: 'long-password', name: 'N' });
    assert.equal(response.status, 400, path);
  }
});

// Pins non-string validation at workspace, invite, and token boundaries.
test('workspace, invite, and token boundaries reject non-string values', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, 'boundary-owner@example.test');
  const id = (await owner.post('/api/workspaces').send({ name: 'Boundary' })).body.workspace.id;
  assert.equal((await owner.post('/api/workspaces').send({ name: { bad: true } })).status, 400);
  assert.equal(
    (
      await owner
        .post(`/api/workspaces/${id}/invite`)
        .send({ email: { bad: true }, role: 'viewer' })
    ).status,
    400,
  );
  assert.equal(
    (await owner.post(`/api/workspaces/${id}/tokens`).send({ name: { bad: true } })).status,
    400,
  );
});

// Pins periodic global cleanup of stale rate-limit buckets.
test('global rate-limit sweep removes stale rows from other buckets', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60 * 1000;
  t.after(() => {
    Date.now = originalNow;
  });
  const stale = Date.now() - 25 * 60 * 60 * 1000;
  db.prepare('INSERT INTO rate_limits (bucket_key,window_start,count) VALUES (?,?,?)').run(
    'other:ip',
    stale,
    4,
  );
  consume(db, { bucketKey: 'current:ip', max: 1, windowMs: 60000 });
  assert.equal(
    db.prepare('SELECT 1 FROM rate_limits WHERE bucket_key=?').get('other:ip'),
    undefined,
  );
});

// Pins invite acceptance preserving an existing membership role.
test('accepting an invite preserves an existing membership role', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, 'invite-owner@example.test', 'Owner');
  const viewer = await register(app, 'invite-viewer@example.test', 'Viewer');
  const workspace = await owner.post('/api/workspaces').send({ name: 'Invite' });
  const id = workspace.body.workspace.id;
  db.prepare('INSERT INTO memberships (user_id,workspace_id,role) VALUES (?,?,?)').run(
    db.prepare('SELECT id FROM users WHERE email=?').get('invite-viewer@example.test').id,
    id,
    'viewer',
  );
  const invite = await owner.post(`/api/workspaces/${id}/invite`).send({
    email: 'invite-viewer@example.test', role: 'analyst',
  });
  const token = invite.body.inviteUrl.split('/').pop();
  const response = await viewer.post(`/api/invites/${token}/accept`);
  assert.equal(response.status, 200);
  assert.equal(response.body.workspace.role, 'viewer');
  assert.equal(db.prepare('SELECT role FROM memberships WHERE user_id=? AND workspace_id=?').get(
    db.prepare('SELECT id FROM users WHERE email=?').get('invite-viewer@example.test').id, id,
  ).role, 'viewer');
});

// Pins upload factory defaults for later evidence routes.
test('upload factory applies default caps', () => {
  const upload = createUpload();
  assert.ok(upload.limits.fileSize);
  assert.ok(upload.limits.files);
  assert.ok(upload.limits.fields);
});

// Pins the documented nanoid, audit-exception, and guard status contracts.
test('docs describe the require(esm) nanoid mechanism and audit exception', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const spec = fs.readFileSync('SPEC.md', 'utf8');
  assert.doesNotMatch(agents, /nanoid.*dynamic `import\(\)`/);
  assert.match(agents, /nanoid\s+\^6\.0\.1/);
  assert.match(agents, /demo sweeper/);
  assert.match(agents, /expired `is_demo=1` workspace/);
  assert.match(spec, /demo sweeper/);
  assert.match(spec, /`is_demo=1` workspace past `expires_at`/);
  assert.match(spec, /storage error.*403/i);
});

// Pins Google callback session regeneration and demo-grant removal.
test('google callback regenerates session without demo grant', async (t) => {
  const { db } = makeDb();
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const app = createApp(db, { startSweeper: false });
  t.after(() => {
    close(app, db);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
  const agent = await register(app, 'google-callback@example.test');
  const sid = db.prepare('SELECT sid FROM sessions ORDER BY rowid DESC LIMIT 1').get().sid;
  db.prepare('UPDATE sessions SET session_json=? WHERE sid=?').run(
    JSON.stringify({ cookie: { originalMaxAge: null }, demoWorkspaceId: 'demo' }), sid,
  );
  const original = passport.authenticate;
  passport.authenticate = (name, callback) => (req, res) => callback(null, {
    id: 'google-user', email: 'google-callback@example.test', name: 'Google',
  });
  t.after(() => {
    passport.authenticate = original;
  });
  const response = await agent.get('/api/auth/google/callback');
  assert.equal(response.status, 302);
  const latest = db.prepare('SELECT session_json FROM sessions ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(Object.hasOwn(JSON.parse(latest.session_json), 'demoWorkspaceId'), false);
});

// Pins logout destruction of server-side authentication state.
test('logout destroys the server-side session', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const agent = await register(app, 'logout@example.test');
  const sid = db.prepare('SELECT sid FROM sessions ORDER BY rowid DESC LIMIT 1').get().sid;
  const response = await agent.post('/api/auth/logout');
  assert.deepEqual(response.body, { success: true });
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE sid=?').get(sid), undefined);
  assert.equal((await agent.get('/api/auth/session')).body.user, null);
});

// Pins indistinguishable cross-tenant and nonexistent workspace responses.
test('cross-tenant workspace 404 is byte-identical to nonexistent workspace', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, 'tenant-owner@example.test');
  const other = await register(app, 'tenant-other@example.test');
  const id = (await owner.post('/api/workspaces').send({ name: 'Tenant' })).body.workspace.id;
  const denied = await other.get(`/api/workspaces/${id}`);
  const missing = await other.get('/api/workspaces/does-not-exist');
  assert.equal(denied.status, missing.status);
  assert.equal(JSON.stringify(denied.body), JSON.stringify(missing.body));
  assert.equal(denied.headers['x-workspace'], undefined);
});

// Pins SSE channel isolation and cleanup after failed writes.
test('SSE channels are isolated and failed writes evict subscribers', () => {
  const makeResponse = (throws) => {
    const listeners = {};
    return {
      listeners,
      set() {},
      flushHeaders() {},
      writes: [],
      write(value) {
        this.writes.push(value);
        if (throws) throw new Error('closed');
      },
      on(event, callback) {
        listeners[event] = callback;
      },
    };
  };
  const one = makeResponse(false);
  const two = makeResponse(false);
  const dead = makeResponse(true);
  const cleanup = require('../../src/sse/hub').subscribe('one', one, { heartbeatMs: 100000 });
  require('../../src/sse/hub').subscribe('two', two, { heartbeatMs: 100000 });
  require('../../src/sse/hub').subscribe('one', dead, { heartbeatMs: 100000 });
  const hub = require('../../src/sse/hub');
  hub.broadcast('one', 'event', { id: 1 });
  assert.equal(one.writes.length, 1);
  assert.match(one.writes[0], /event: event/);
  assert.equal(two.writes.length, 0);
  assert.equal(hub.subscriberCount('one'), 1);
  assert.equal(hub.subscriberCount('two'), 1);
  cleanup();
  two.listeners.close();
  assert.equal(hub.subscriberCount('one'), 0);
  assert.equal(hub.subscriberCount('two'), 0);
});
