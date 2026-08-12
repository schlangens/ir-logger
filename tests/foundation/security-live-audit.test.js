// Regression pins for properties confirmed by a live, hands-on attack audit
// of `main` (2026-08-12). Each was previously verified only by manually
// driving a running server; nothing in the suite guarded them. See the
// commit message for the audit context. Every test here must fail if the
// property it pins is broken — see the PR/commit notes for the break/restore
// evidence proving that.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'live-audit-test-secret';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const passport = require('passport');

// EVIDENCE_DIR must be set before src/server (and its evidence-route chain)
// is required, since src/uploads/storage.js captures it at module load.
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-live-audit-evidence-'));
process.env.EVIDENCE_DIR = evidenceDir;

const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');
const { resolveWorkspaceAccess } = require('../../src/middleware/workspace-guard');
const { configurePassport } = require('../../src/auth/passport');
const seedDemoWorkspace = require('../../src/services/demo-seed');
const { sweep } = require('../../src/services/demo-sweeper');

const DUMMY_PASSWORD_HASH = '$2b$12$OMlK4xPY06neMxOFsN2CwOPkJiVsbtRgxI6jKZrkWRmd9fsvTwlr6';

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

function insertIncident(db, { id, workspaceId, createdBy, ref = 'IR-TEST-0001', title = 'Incident', severity = 'low' }) {
  db.prepare(
    'INSERT INTO incidents (id,workspace_id,ref,title,severity,created_by) VALUES (?,?,?,?,?,?)',
  ).run(id, workspaceId, ref, title, severity, createdBy);
}

// Builds a raw multipart/form-data body with an attacker-controlled filename
// exactly as it would appear on the wire. supertest/superagent's normal
// `.attach()` helper delegates to the `form-data` package, which calls
// `path.basename()` on the filename before it ever leaves the client — that
// masks whether the *server* actually neutralizes a traversal filename.
// Building the body by hand exercises the real server-side path.
function rawMultipartUpload(agent, urlPath, { filename, contentType = 'text/plain', body = 'payload' }) {
  const boundary = `----liveAudit${crypto.randomBytes(8).toString('hex')}`;
  const raw = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n` +
      `${body}\r\n--${boundary}--\r\n`,
  );
  return agent
    .post(urlPath)
    .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
    .send(raw);
}

// --- Property 1: a demo session cannot reach a real tenant's data --------

test('demo session is refused with a consistent status on every route across a real tenant\'s workspace, matrix, evidence, download, and custody', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));

  // A real tenant: real owner, real workspace, real incident, real evidence.
  const owner = await register(app, 'real-owner@example.test', 'Real Owner');
  const workspaceRes = await owner.agent.post('/api/workspaces').send({ name: 'Real Tenant Workspace' });
  const workspaceId = workspaceRes.body.workspace.id;
  const incidentId = 'real-tenant-incident';
  insertIncident(db, {
    id: incidentId,
    workspaceId,
    createdBy: owner.id,
    ref: 'IR-REAL-0001',
    title: 'Real Confidential Incident',
    severity: 'critical',
  });
  const evidenceId = 'real-tenant-evidence';
  const storedPath = path.join(evidenceDir, 'real-tenant-evidence.bin');
  fs.writeFileSync(storedPath, 'real tenant secret bytes');
  db.prepare(
    `INSERT INTO evidence (id,incident_id,filename,mime,size,sha256,stored_path,uploaded_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(evidenceId, incidentId, 'real-secret-filename.txt', 'text/plain', 24, 'deadbeef', storedPath, owner.id);

  // A separate, unrelated demo workspace/session.
  const demoAgent = request.agent(app);
  // POST /api/demo enforces a same-origin check (CSRF: it is the only
  // unauthenticated state-creating endpoint, and it regenerates the session).
  // A browser always sends Origin on a same-origin POST; supertest does not,
  // so set it explicitly. Omitting it is correctly a 403.
  const demoResponse = await demoAgent
    .post('/api/demo')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost');
  assert.equal(demoResponse.status, 201);
  assert.notEqual(demoResponse.body.workspaceId, workspaceId);

  const secrets = [
    workspaceId,
    incidentId,
    evidenceId,
    'real-secret-filename.txt',
    'Real Confidential Incident',
    'IR-REAL-0001',
    owner.id,
  ];
  function assertNoLeak(response, label) {
    const raw = JSON.stringify(response.body ?? null) + (typeof response.text === 'string' ? response.text : '');
    for (const secret of secrets) {
      assert.equal(raw.includes(secret), false, `${label} leaked "${secret}"`);
    }
  }

  const routes = [
    ['workspace', () => demoAgent.get(`/api/workspaces/${workspaceId}`)],
    ['incident matrix', () => demoAgent.get(`/api/incidents/${incidentId}/matrix`)],
    ['evidence list', () => demoAgent.get(`/api/incidents/${incidentId}/evidence`)],
    ['evidence by id', () => demoAgent.get(`/api/evidence/${evidenceId}`)],
    ['evidence download', () => demoAgent.get(`/api/evidence/${evidenceId}/download`)],
    ['evidence custody', () => demoAgent.get(`/api/evidence/${evidenceId}/custody`)],
  ];
  for (const [label, run] of routes) {
    const response = await run();
    assert.equal(response.status, 401, `${label} status`);
    assertNoLeak(response, label);
  }
});

// --- Property 2: the synthetic demo user cannot authenticate -------------
//
// NOTE ON SCOPE: the local-login half of this property is pinned below and
// verified false-if-broken. The "Google path also refuses it" half is
// deliberately NOT pinned as a passing assertion, because direct execution
// against `main` shows it is not true at the application-code level today.
// `resolveGoogleUser` in src/auth/passport.js links (and authenticates) any
// existing user row — including an is_demo=1 row with no google_id — to
// whatever Google profile presents a `verified: true` email matching that
// row's email. Reproduced directly: calling
// `resolveGoogleUser(db, { id: 'attacker', emails: [{ value: demoUser.email,
// verified: true }] })` against a freshly demo-seeded database returns the
// demo user (not `false`) and writes a google_id onto that row. In today's
// deployment this is only safe because Google itself can never assert
// `verified: true` for an `@demo.invalid` address (that TLD is reserved and
// unresolvable, so no Google account can exist for it) — that protection
// lives outside this app's code, not in it. Writing `assert.equal(result,
// false)` here would be a false assertion against current `main` and would
// fail immediately; adding it was declined per this task's "no tautologies /
// do not fake it" rule. An open, unmerged PR (devin/1786553140, "resolve
// demo actor and harden demo/foundation seams") independently fixes this by
// adding `if (user.is_demo === 1) return false;` to both branches of
// `resolveGoogleUser` — confirming this is a real, known, already-targeted
// gap rather than a misreading on this pin's part.

test('the synthetic demo user cannot log in locally with any password, because it has no password hash and no linked Google id — not incidentally', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));

  const seeded = seedDemoWorkspace(db);
  const demoUser = db.prepare('SELECT * FROM users WHERE id=?').get(seeded.userId);
  assert.equal(demoUser.is_demo, 1);
  assert.equal(demoUser.password_hash, null, 'demo user must have no password hash');
  assert.equal(demoUser.google_id, null, 'demo user must have no linked google id');

  // Control: a normal user CAN log in on this same app instance with the
  // right password — proving the demo user's rejections below aren't just a
  // generally-broken login path.
  await request(app).post('/api/auth/register').send({
    email: 'control-user@example.test',
    name: 'Control',
    password: 'long-password',
  });
  const control = await request(app).post('/api/auth/login').send({
    email: 'control-user@example.test',
    password: 'long-password',
  });
  assert.equal(control.status, 200);

  for (const password of ['', 'wrong', 'long-password', 'correct horse battery staple demo']) {
    const response = await request(app).post('/api/auth/login').send({
      email: demoUser.email,
      password,
    });
    assert.equal(response.status, 401, `password=${JSON.stringify(password)}`);
    assert.equal(response.body.error, 'Invalid credentials');
  }

  // Confirm the mechanism directly: the local strategy still runs a
  // constant-time bcrypt comparison against the fixed dummy hash — it is not
  // short-circuiting some other way that would only incidentally fail.
  configurePassport(db);
  const strategy = passport._strategies.local;
  const originalCompare = bcrypt.compare;
  let comparedAgainstHash;
  bcrypt.compare = async (candidate, hash) => {
    comparedAgainstHash = hash;
    return originalCompare(candidate, hash);
  };
  t.after(() => {
    bcrypt.compare = originalCompare;
  });
  const outcome = await new Promise((resolve, reject) =>
    strategy._verify(demoUser.email, 'any-password-at-all', (error, user) =>
      error ? reject(error) : resolve(user),
    ),
  );
  assert.equal(outcome, false);
  assert.equal(comparedAgainstHash, DUMMY_PASSWORD_HASH);
});

// --- Property 3: workspace guard denies expiry itself, before the sweeper -

test('workspace guard denies an expired demo grant on its own, before and independent of the sweeper ever running', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));

  const demoAgent = request.agent(app);
  // POST /api/demo enforces a same-origin check (CSRF: it is the only
  // unauthenticated state-creating endpoint, and it regenerates the session).
  // A browser always sends Origin on a same-origin POST; supertest does not,
  // so set it explicitly. Omitting it is correctly a 403.
  const demoResponse = await demoAgent
    .post('/api/demo')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost');
  assert.equal(demoResponse.status, 201);
  const { workspaceId, incidentId } = demoResponse.body;

  // Sanity: access works while the grant is live.
  assert.equal((await demoAgent.get(`/api/workspaces/${workspaceId}`)).status, 200);

  // Expire the workspace directly in the database. The sweeper is never
  // started on this app (startSweeper: false) and `sweep()` is never called.
  db.prepare('UPDATE workspaces SET expires_at=? WHERE id=?').run(
    new Date(Date.now() - 1000).toISOString(),
    workspaceId,
  );

  assert.equal((await demoAgent.get(`/api/workspaces/${workspaceId}`)).status, 401);
  assert.equal((await demoAgent.get(`/api/incidents/${incidentId}/matrix`)).status, 401);
  assert.equal((await demoAgent.get(`/api/incidents/${incidentId}/evidence`)).status, 401);

  assert.equal(
    resolveWorkspaceAccess(db, { session: { demoWorkspaceId: workspaceId } }, workspaceId).ok,
    false,
  );

  // The rows are still there — nothing cleaned them up. The guard itself,
  // not the cleanup job, is what refused access above.
  assert.ok(db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId));
  assert.ok(db.prepare('SELECT id FROM incidents WHERE id=?').get(incidentId));
});

// --- Property 4: downloads are always forced to a safe disposition -------

test('evidence downloads are forced to a safe disposition regardless of a declared image/svg+xml mime type, and bytes/hash round-trip exactly', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));

  const owner = await register(app, 'svg-owner@example.test', 'SVG Owner');
  const workspaceRes = await owner.agent.post('/api/workspaces').send({ name: 'SVG Workspace' });
  const workspaceId = workspaceRes.body.workspace.id;
  const incidentId = 'svg-incident';
  insertIncident(db, { id: incidentId, workspaceId, createdBy: owner.id, ref: 'IR-SVG-0001', title: 'SVG Incident' });

  const svgPayload = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><script>alert(1)</script></svg>',
  );
  const expectedSha256 = crypto.createHash('sha256').update(svgPayload).digest('hex');

  const upload = await owner.agent
    .post(`/api/incidents/${incidentId}/evidence`)
    .attach('file', svgPayload, { filename: 'payload.svg', contentType: 'image/svg+xml' });
  assert.equal(upload.status, 201);
  const evidenceId = upload.body.evidence.id;
  assert.equal(db.prepare('SELECT mime FROM evidence WHERE id=?').get(evidenceId).mime, 'image/svg+xml');
  assert.equal(upload.body.evidence.sha256, expectedSha256);

  const download = await owner.agent.get(`/api/evidence/${evidenceId}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-type'], 'application/octet-stream');
  assert.match(download.headers['content-disposition'], /^attachment; filename="[^"]+"$/);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(download.body, svgPayload);
  assert.equal(crypto.createHash('sha256').update(download.body).digest('hex'), expectedSha256);
  assert.equal(
    db.prepare('SELECT sha256 FROM evidence WHERE id=?').get(evidenceId).sha256,
    expectedSha256,
  );
});

// --- Property 5: path-traversal filenames are neutralized ----------------

test('a path-traversal filename is neutralized: the file lands under a server-generated name inside the evidence directory, nothing is written outside it, and the recorded display name is sanitized', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));

  const owner = await register(app, 'traversal-owner@example.test', 'Traversal Owner');
  const workspaceRes = await owner.agent.post('/api/workspaces').send({ name: 'Traversal Workspace' });
  const workspaceId = workspaceRes.body.workspace.id;
  const incidentId = 'traversal-incident';
  insertIncident(db, { id: incidentId, workspaceId, createdBy: owner.id, ref: 'IR-TRAV-0001', title: 'Traversal Incident' });

  for (const filename of ['../../../../tmp/evil-slash.txt', '..\\..\\..\\windows\\evil-backslash.txt']) {
    const before = fs.readdirSync(evidenceDir).sort();
    const upload = await rawMultipartUpload(owner.agent, `/api/incidents/${incidentId}/evidence`, {
      filename,
      body: 'traversal payload',
    });
    assert.equal(upload.status, 201, filename);
    const evidenceId = upload.body.evidence.id;
    const row = db.prepare('SELECT filename,stored_path FROM evidence WHERE id=?').get(evidenceId);

    // Stored under a server-generated name inside the evidence directory.
    assert.equal(path.dirname(row.stored_path), evidenceDir, filename);
    assert.match(path.basename(row.stored_path), /^[A-Za-z0-9_-]{24}\.bin$/, filename);

    // Nothing was written outside the evidence directory: exactly one new
    // file appeared, and it's the generated name above.
    const after = fs.readdirSync(evidenceDir).sort();
    assert.equal(after.length, before.length + 1, filename);
    assert.deepEqual(
      after.filter((name) => !before.includes(name)),
      [path.basename(row.stored_path)],
      filename,
    );

    // The recorded display name is sanitized.
    assert.ok(row.filename.length > 0, filename);
    assert.equal(row.filename.includes('/'), false, filename);
    assert.equal(row.filename.includes('\\'), false, filename);
    assert.equal(row.filename.includes('..'), false, filename);
    assert.equal(upload.body.evidence.filename, row.filename, filename);

    assert.equal(fs.readFileSync(row.stored_path, 'utf8'), 'traversal payload', filename);
  }
});

// --- Property 6: sweeper tolerates a missing file and isolates failures --

test('the demo sweeper tolerates an already-missing evidence file as success, and one workspace failing does not block another expired workspace from being swept in the same run', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());

  const tolerated = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 2000).toISOString() });
  fs.unlinkSync(tolerated.storedPath); // the file is already gone before sweep runs

  const broken = seedDemoWorkspace(db, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const originalUnlink = fs.unlinkSync;
  fs.unlinkSync = (target) => {
    if (target === broken.storedPath) {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
    return originalUnlink(target);
  };
  t.after(() => {
    fs.unlinkSync = originalUnlink;
  });

  const result = sweep(db);
  assert.deepEqual(result, { swept: 1, failed: 1 });

  // The already-missing-file workspace was fully swept (tolerated as success).
  assert.equal(db.prepare('SELECT id FROM workspaces WHERE id=?').get(tolerated.workspaceId), undefined);

  // The broken workspace's failure was isolated: it's still there, and it
  // did not prevent the other expired workspace above from being swept in
  // the same run.
  assert.ok(db.prepare('SELECT id FROM workspaces WHERE id=?').get(broken.workspaceId));
});
