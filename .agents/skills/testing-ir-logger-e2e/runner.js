const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const { openDatabase } = require(path.join(REPO, 'src/db'));

const DB_PATH = '/tmp/ir-logger-e2e.db';
const EVIDENCE_DIR = '/tmp/ir-logger-e2e-evidence';
const PORT = '3059';
const BASE = `http://localhost:${PORT}`;

// Reset temp state.
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, `${DB_PATH}-journal`]) {
  try { fs.unlinkSync(f); } catch {}
}
fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const env = { ...process.env, DB_PATH, EVIDENCE_DIR, PORT, SESSION_SECRET: 'e2e-test' };
const server = spawn('node', ['src/server.js'], { cwd: REPO, env, stdio: 'pipe' });
let serverOutput = '';
server.stdout.on('data', (d) => { const s = d.toString(); serverOutput += s; process.stdout.write(`[SERVER] ${s}`); });
server.stderr.on('data', (d) => { const s = d.toString(); serverOutput += s; process.stderr.write(`[SERVER ERR] ${s}`); });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200 && r.body && r.body.status === 'ok') return;
    } catch {}
    await sleep(100);
  }
  throw new Error('Server did not become healthy');
}

function parseCookies(setCookieHeader) {
  const out = [];
  if (!setCookieHeader) return out;
  for (const sc of Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]) {
    const [nameValue] = sc.split(';');
    const idx = nameValue.indexOf('=');
    if (idx === -1) continue;
    out.push({ name: nameValue.slice(0, idx), value: nameValue.slice(idx + 1), raw: sc });
  }
  return out;
}

function jarCookieHeader(jar) {
  return Object.entries(jar).map(([name, val]) => `${name}=${val}`).join('; ');
}

function request(method, urlPath, { body, headers = {}, jar } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname: 'localhost', port: PORT, path: urlPath, headers: { ...headers } };
    if (jar) {
      const cookies = jarCookieHeader(jar);
      if (cookies) opts.headers['Cookie'] = cookies;
    }
    if (body !== undefined) {
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (jar && res.headers['set-cookie']) {
          for (const c of parseCookies(res.headers['set-cookie'])) jar[c.name] = c.value;
        }
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch { parsed = chunks; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: chunks });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
function assert(name, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}${details ? ': ' + details : ''}`);
  }
}

async function main() {
  await waitForHealth();
  console.log('--- Server healthy, starting e2e assertions ---');

  const demoJar = {};

  // 1.1 POST /api-demo returns snake_case ids
  const demo = await request('POST', '/api/demo', { headers: { Origin: BASE, 'Content-Type': 'application/json' }, jar: demoJar, body: {} });
  assert('POST /api/demo returns 201', demo.status === 201, `status=${demo.status}, body=${JSON.stringify(demo.body)}`);
  const workspaceId = demo.body?.workspace_id;
  const incidentId = demo.body?.incident_id;
  assert('demo response has workspace_id', typeof workspaceId === 'string' && workspaceId.length > 0, workspaceId);
  assert('demo response has incident_id', typeof incidentId === 'string' && incidentId.length > 0, incidentId);
  assert('workspace_id is snake_case', !demo.body || demo.body.workspaceId === undefined, 'camelCase workspaceId present');
  assert('incident_id is snake_case', !demo.body || demo.body.incidentId === undefined, 'camelCase incidentId present');

  const db = openDatabase(DB_PATH);
  const demoUser = db.prepare("SELECT id FROM users WHERE email = 'demo-' || ? || '@demo.invalid'").get(workspaceId);
  const demoUserId = demoUser?.id;
  assert('synthetic demo user exists in DB', typeof demoUserId === 'string' && demoUserId.length > 0, demoUser);

  const sessionFromDemo = db.prepare('SELECT session_json FROM sessions').get();
  const sidMatch = sessionFromDemo && JSON.parse(sessionFromDemo.session_json);
  assert('demo session is stored', sidMatch && sidMatch.demoWorkspaceId === workspaceId, sessionFromDemo);

  // 1.2 Demo actor creates an incident and is attributed
  const incidentRes = await request('POST', `/api/workspaces/${workspaceId}/incidents`, { jar: demoJar, body: { title: 'Demo visitor incident', severity: 'medium' } });
  assert('POST /workspaces/:id/incidents returns 201', incidentRes.status === 201, `status=${incidentRes.status}, body=${JSON.stringify(incidentRes.body)}`);
  const newIncidentId = incidentRes.body?.incident?.id;
  assert('created incident has id', typeof newIncidentId === 'string' && newIncidentId.length > 0, incidentRes.body);

  const createdBy = db.prepare('SELECT created_by FROM incidents WHERE id = ?').get(newIncidentId);
  assert('incident.created_by equals demo user id', createdBy?.created_by === demoUserId, `${createdBy?.created_by} vs ${demoUserId}`);
  assert('created_by is not null', createdBy?.created_by !== null, createdBy);
  assert('created_by is not the session id', createdBy?.created_by !== sidMatch, `${createdBy?.created_by}`);

  const auditCreated = db.prepare("SELECT actor_user_id FROM audit_log WHERE action='incident.created' AND target_id = ?").get(newIncidentId);
  assert('audit incident.created actor_user_id equals demo user id', auditCreated?.actor_user_id === demoUserId, `${auditCreated?.actor_user_id} vs ${demoUserId}`);

  // 1.3 Demo actor adds a technical entry with technique
  const entryRes = await request('POST', `/api/incidents/${incidentId}/entries`, { jar: demoJar, body: { kind: 'technical', body_md: 'PowerShell observed during investigation', technique_ids: ['T1059'] } });
  assert('POST /incidents/:id/entries returns 201', entryRes.status === 201, `status=${entryRes.status}, body=${JSON.stringify(entryRes.body)}`);
  const entryId = entryRes.body?.entry?.id;
  assert('created entry has id', typeof entryId === 'string' && entryId.length > 0, entryRes.body);

  const entryAuthor = db.prepare('SELECT author_user_id FROM entries WHERE id = ?').get(entryId);
  assert('entry.author_user_id equals demo user id', entryAuthor?.author_user_id === demoUserId, `${entryAuthor?.author_user_id} vs ${demoUserId}`);

  const entryTech = db.prepare('SELECT technique_id FROM entry_techniques WHERE entry_id = ?').get(entryId);
  assert('entry_techniques row exists for T1059', entryTech?.technique_id === 'T1059', entryTech);

  const entryAudit = db.prepare("SELECT actor_user_id FROM audit_log WHERE action='entry.created' AND target_id = ?").get(entryId);
  assert('audit entry.created actor_user_id equals demo user id', entryAudit?.actor_user_id === demoUserId, `${entryAudit?.actor_user_id} vs ${demoUserId}`);

  // 1.4 Demo actor patches incident
  const patchRes = await request('PATCH', `/api/incidents/${incidentId}`, { jar: demoJar, body: { severity: 'critical', status: 'closed' } });
  assert('PATCH /incidents/:id returns 200', patchRes.status === 200, `status=${patchRes.status}, body=${JSON.stringify(patchRes.body)}`);

  const patched = db.prepare('SELECT severity, status FROM incidents WHERE id = ?').get(incidentId);
  assert('incident severity updated to critical', patched?.severity === 'critical', patched?.severity);
  assert('incident status updated to closed', patched?.status === 'closed', patched?.status);

  const auditUpdated = db.prepare("SELECT actor_user_id FROM audit_log WHERE action='incident.updated' AND target_id = ?").all(incidentId);
  assert('audit incident.updated rows exist', auditUpdated.length >= 1, auditUpdated.length);
  assert('audit incident.updated actor_user_id is demo user', auditUpdated.every((r) => r.actor_user_id === demoUserId), JSON.stringify(auditUpdated.map((r) => r.actor_user_id)));

  // 1.5 Incident cap
  // One incident was already created in 1.2. The seeded workspace has one incident,
  // so a total of four additional incidents (including the one from 1.2) may succeed.
  for (let i = 0; i < 3; i++) {
    const r = await request('POST', `/api/workspaces/${workspaceId}/incidents`, { jar: demoJar, body: { title: `Demo cap ${i}`, severity: 'low' } });
    assert(`additional incident ${i + 1} returns 201`, r.status === 201, `status=${r.status}, body=${JSON.stringify(r.body)}`);
  }
  const overflow = await request('POST', `/api/workspaces/${workspaceId}/incidents`, { jar: demoJar, body: { title: 'Demo cap overflow', severity: 'low' } });
  assert('sixth incident attempt returns 409', overflow.status === 409, `status=${overflow.status}, body=${JSON.stringify(overflow.body)}`);

  const count = db.prepare('SELECT COUNT(*) AS n FROM incidents WHERE workspace_id = ?').get(workspaceId).n;
  assert('incident count is exactly 5', count === 5, count);

  // 1.6 Demo actor cannot create workspace, mint token, or invite
  const workspaceCreateRes = await request('POST', '/api/workspaces', { jar: demoJar, body: { name: 'Demo workspace' } });
  assert('POST /workspaces returns 401 for demo actor', workspaceCreateRes.status === 401, `status=${workspaceCreateRes.status}, body=${JSON.stringify(workspaceCreateRes.body)}`);

  const tokenRes = await request('POST', `/api/workspaces/${workspaceId}/tokens`, { jar: demoJar, body: { name: 'demo token' } });
  assert('POST /workspaces/:id/tokens returns 401 for demo actor', tokenRes.status === 401, `status=${tokenRes.status}, body=${JSON.stringify(tokenRes.body)}`);

  const inviteRes = await request('POST', `/api/workspaces/${workspaceId}/invite`, { jar: demoJar, body: { email: 'demo-invite@example.test', role: 'viewer' } });
  assert('POST /workspaces/:id/invite returns 401 for demo actor', inviteRes.status === 401, `status=${inviteRes.status}, body=${JSON.stringify(inviteRes.body)}`);

  // 2. Real user attribution unchanged
  const realJar = {};
  const unique1 = `real-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reg1 = await request('POST', '/api/auth/register', { jar: realJar, body: { email: `${unique1}@example.test`, name: 'Real User', password: 'long-password-123' } });
  assert('real user registration returns 201', reg1.status === 201, `status=${reg1.status}, body=${JSON.stringify(reg1.body)}`);
  const realUserId = reg1.body?.user?.id;
  assert('real user has id', typeof realUserId === 'string' && realUserId.length > 0, reg1.body);

  const wsRes = await request('POST', '/api/workspaces', { jar: realJar, body: { name: 'Real workspace' } });
  assert('real user creates workspace returns 201', wsRes.status === 201, `status=${wsRes.status}, body=${JSON.stringify(wsRes.body)}`);
  const realWorkspaceId = wsRes.body?.workspace?.id;

  const realIncidentRes = await request('POST', `/api/workspaces/${realWorkspaceId}/incidents`, { jar: realJar, body: { title: 'Real incident', severity: 'low' } });
  assert('real user creates incident returns 201', realIncidentRes.status === 201, `status=${realIncidentRes.status}, body=${JSON.stringify(realIncidentRes.body)}`);
  const realIncidentId = realIncidentRes.body?.incident?.id;

  const realCreatedBy = db.prepare('SELECT created_by FROM incidents WHERE id = ?').get(realIncidentId);
  assert('real incident created_by is real user id', realCreatedBy?.created_by === realUserId, `${realCreatedBy?.created_by} vs ${realUserId}`);

  const realAuditCreated = db.prepare("SELECT actor_user_id FROM audit_log WHERE action='incident.created' AND target_id = ?").get(realIncidentId);
  assert('real audit incident.created actor is real user id', realAuditCreated?.actor_user_id === realUserId, `${realAuditCreated?.actor_user_id} vs ${realUserId}`);

  const realPatchRes = await request('PATCH', `/api/incidents/${realIncidentId}`, { jar: realJar, body: { severity: 'high' } });
  assert('real user patches incident returns 200', realPatchRes.status === 200, `status=${realPatchRes.status}, body=${JSON.stringify(realPatchRes.body)}`);

  const realAuditUpdated = db.prepare("SELECT actor_user_id FROM audit_log WHERE action='incident.updated' AND target_id = ?").all(realIncidentId);
  assert('real audit incident.updated actor is real user id', realAuditUpdated.every((r) => r.actor_user_id === realUserId), JSON.stringify(realAuditUpdated.map((r) => r.actor_user_id)));

  // 3. Authenticated demo refusal without session destruction
  const authJar = {};
  const unique2 = `auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reg2 = await request('POST', '/api/auth/register', { jar: authJar, body: { email: `${unique2}@example.test`, name: 'Auth User', password: 'long-password-456' } });
  assert('second real user registration returns 201', reg2.status === 201, `status=${reg2.status}, body=${JSON.stringify(reg2.body)}`);

  const demoRefused = await request('POST', '/api/demo', { jar: authJar, headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: {} });
  assert('POST /api/demo for authenticated user returns 409', demoRefused.status === 409, `status=${demoRefused.status}, body=${JSON.stringify(demoRefused.body)}`);
  assert('409 response contains clear error message', demoRefused.body?.error === 'Log out to start a demo session', JSON.stringify(demoRefused.body));

  const afterDemoWorkspace = await request('POST', '/api/workspaces', { jar: authJar, body: { name: 'Post-demo workspace' } });
  assert('authenticated session can still create workspace after 409', afterDemoWorkspace.status === 201, `status=${afterDemoWorkspace.status}, body=${JSON.stringify(afterDemoWorkspace.body)}`);

  db.close();

  console.log('\n=== RESULTS ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
}

main()
  .catch((e) => { console.error('FATAL:', e); failed += 1; })
  .finally(() => {
    server.kill();
    setTimeout(() => { server.kill('SIGKILL'); process.exit(failed > 0 ? 1 : 0); }, 500);
  });
