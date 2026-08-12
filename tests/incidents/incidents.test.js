const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');
const { makeApp, register } = require('./helpers');
const hub = require('../../src/sse/hub');

test('incidents generate yearly refs and annotate activity', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'incident-owner@example.test', 'Owner');
  const workspace = await user.post('/api/workspaces').send({ name: 'Incident workspace' });
  const id = workspace.body.workspace.id;
  const first = await user.post(`/api/workspaces/${id}/incidents`).send({ title: 'First', severity: 'high' });
  const second = await user.post(`/api/workspaces/${id}/incidents`).send({ title: 'Second', severity: 'medium' });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.match(first.body.incident.ref, /^IR-\d{4}-0001$/);
  assert.match(second.body.incident.ref, /^IR-\d{4}-0002$/);
  assert.equal((await user.get(`/api/workspaces/${id}/incidents`)).body.incidents[0].entry_count, 0);
  const fetched = (await user.get(`/api/incidents/${first.body.incident.id}`)).body.incident;
  assert.equal(fetched.last_activity_at, fetched.opened_at);
  assert.equal(fetched.entry_count, 0);
});

test('incident close and reopen are owner-only', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const owner = await register(fixture.app, 'close-owner@example.test', 'Owner');
  const analyst = await register(fixture.app, 'close-analyst@example.test', 'Analyst');
  const workspace = await owner.post('/api/workspaces').send({ name: 'Close workspace' });
  const id = workspace.body.workspace.id;
  const invite = await owner.post(`/api/workspaces/${id}/invite`).send({ email: 'close-analyst@example.test', role: 'analyst' });
  await analyst.post(`/api/invites/${invite.body.inviteUrl.split('/').pop()}/accept`);
  const incident = await owner.post(`/api/workspaces/${id}/incidents`).send({ title: 'Close me', severity: 'low' });
  assert.equal((await analyst.patch(`/api/incidents/${incident.body.incident.id}`).send({ status: 'closed' })).status, 403);
  const closed = await owner.patch(`/api/incidents/${incident.body.incident.id}`).send({ status: 'closed' });
  assert.ok(closed.body.incident.closed_at);
  assert.equal((await analyst.patch(`/api/incidents/${incident.body.incident.id}`).send({ status: 'open' })).status, 403);
  const reopened = await owner.patch(`/api/incidents/${incident.body.incident.id}`).send({ status: 'open' });
  assert.equal(reopened.body.incident.closed_at, null);
});

test('incident listing filters, paginates, and reports totals and activity', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'incident-list@example.test', 'Owner');
  const workspace = await user.post('/api/workspaces').send({ name: 'List workspace' });
  const wid = workspace.body.workspace.id;
  const a = await user.post(`/api/workspaces/${wid}/incidents`).send({ title: 'High open', severity: 'high' });
  await user.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Low open', severity: 'low' });
  const c = await user.post(`/api/workspaces/${wid}/incidents`).send({ title: 'High contained', severity: 'high' });
  await user.patch(`/api/incidents/${c.body.incident.id}`).send({ status: 'contained' });
  const filtered = await user.get(`/api/workspaces/${wid}/incidents`).query({ severity: 'high', status: 'open', limit: 1, offset: 0 });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.incidents.length, 1);
  const page = await user.get(`/api/workspaces/${wid}/incidents`).query({ limit: 1, offset: 1 });
  assert.equal(page.body.total, 3);
  assert.equal(page.body.incidents.length, 1);
  const entry = await user.post(`/api/incidents/${a.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'activity' });
  assert.equal(entry.status, 201);
  const listed = await user.get(`/api/workspaces/${wid}/incidents`).query({ severity: 'high', status: 'open' });
  const listedIncident = listed.body.incidents.find((item) => item.id === a.body.incident.id);
  assert.equal(listedIncident.entry_count, 1);
  assert.notEqual(listedIncident.last_activity_at, listedIncident.opened_at);
  const fetched = await user.get(`/api/incidents/${a.body.incident.id}`);
  assert.equal(fetched.body.incident.entry_count, 1);
});

test('incident validation, viewer permissions, audit, and update broadcast', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const owner = await register(fixture.app, 'incident-audit-owner@example.test', 'Owner');
  const viewer = await register(fixture.app, 'incident-audit-viewer@example.test', 'Viewer');
  const wid = (await owner.post('/api/workspaces').send({ name: 'Audit workspace' })).body.workspace.id;
  const invite = await owner.post(`/api/workspaces/${wid}/invite`).send({ email: 'incident-audit-viewer@example.test', role: 'viewer' });
  await viewer.post(`/api/invites/${invite.body.inviteUrl.split('/').pop()}/accept`);
  const incident = await owner.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Audited', severity: 'low' });
  const id = incident.body.incident.id;
  assert.equal((await owner.patch(`/api/incidents/${id}`).send({ severity: 'bad' })).status, 400);
  assert.equal((await owner.patch(`/api/incidents/${id}`).send({ status: 'bad' })).status, 400);
  assert.equal((await owner.patch(`/api/incidents/${id}`).send({ title: 42 })).status, 400);
  assert.equal((await viewer.patch(`/api/incidents/${id}`).send({ title: 'Nope' })).status, 403);
  assert.equal((await viewer.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Nope', severity: 'low' })).status, 403);
  const originalBroadcast = hub.broadcast;
  const events = [];
  hub.broadcast = (...args) => events.push(args);
  t.after(() => { hub.broadcast = originalBroadcast; });
  const changed = await owner.patch(`/api/incidents/${id}`).send({ title: 'Changed', severity: 'medium' });
  assert.equal(changed.status, 200);
  assert.deepEqual(events[0].slice(0, 2), [id, 'incident.updated']);
  assert.deepEqual(events[0][2].changes, { title: 'Changed', severity: 'medium' });
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='incident.updated' AND target_id=?").get(id).count, 2);
});

test('incident bare-id routes isolate tenants and demo cap is transactional', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const owner = await register(fixture.app, 'incident-tenant-owner@example.test', 'Owner');
  const other = await register(fixture.app, 'incident-tenant-other@example.test', 'Other');
  const wid = (await owner.post('/api/workspaces').send({ name: 'Tenant A' })).body.workspace.id;
  const otherWid = (await other.post('/api/workspaces').send({ name: 'Tenant B' })).body.workspace.id;
  const incident = await owner.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Private', severity: 'low' });
  const crossTenant = await other.get(`/api/incidents/${incident.body.incident.id}`);
  assert.equal(crossTenant.status, 404);
  assert.equal(crossTenant.body.error, 'Incident not found');
  const missingIncident = await other.get('/api/incidents/does-not-exist');
  assert.equal(missingIncident.status, 404);
  assert.deepEqual(missingIncident.body, crossTenant.body);
  assert.equal((await other.patch(`/api/incidents/${incident.body.incident.id}`).send({ title: 'Nope' })).status, 404);
  fixture.db.prepare('UPDATE workspaces SET is_demo=1 WHERE id=?').run(wid);
  for (let i = 0; i < 4; i++) await owner.post(`/api/workspaces/${wid}/incidents`).send({ title: `Demo ${i}`, severity: 'low' });
  assert.equal((await owner.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Sixth', severity: 'low' })).status, 409);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM incidents WHERE workspace_id=?').get(wid).count, 5);
  for (let i = 0; i < 5; i++) await other.post(`/api/workspaces/${otherWid}/incidents`).send({ title: `Normal ${i}`, severity: 'low' });
  assert.equal((await other.post(`/api/workspaces/${otherWid}/incidents`).send({ title: 'Normal sixth', severity: 'low' })).status, 201);
});

test('incident stream guards tenants, emits entries, heartbeats, and cleans up', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const ownerRegistration = await request(fixture.app).post('/api/auth/register').send({
    email: 'stream-owner@example.test', name: 'Owner', password: 'round2a-password',
  });
  const ownerCookie = ownerRegistration.headers['set-cookie'][0].split(';')[0];
  const otherRegistration = await request(fixture.app).post('/api/auth/register').send({
    email: 'stream-other@example.test', name: 'Other', password: 'round2a-password',
  });
  const otherCookie = otherRegistration.headers['set-cookie'][0].split(';')[0];
  const workspace = await request(fixture.app).post('/api/workspaces').set('Cookie', ownerCookie).send({ name: 'Stream workspace' });
  const incident = await request(fixture.app).post(`/api/workspaces/${workspace.body.workspace.id}/incidents`).set('Cookie', ownerCookie).send({ title: 'Streaming', severity: 'low' });
  const incidentId = incident.body.incident.id;
  const originalSubscribe = hub.subscribe;
  hub.subscribe = (id, res) => originalSubscribe(id, res, { heartbeatMs: 15 });
  t.after(() => { hub.subscribe = originalSubscribe; });
  assert.equal(hub.HEARTBEAT_INTERVAL_MS, 25000);
  const server = await new Promise((resolve) => {
    const value = fixture.app.listen(0, () => resolve(value));
  });
  t.after(() => server.close());
  const port = server.address().port;
  const stream = await new Promise((resolve, reject) => {
    const req = http.request({ port, path: `/api/incidents/${incidentId}/stream`, headers: { Cookie: ownerCookie } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.includes(': heartbeat\n\n')) resolve({ req, res, getBody: () => body });
      });
      res.on('error', reject);
    });
    req.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); });
    req.end();
  });
  assert.match(stream.res.headers['content-type'], /^text\/event-stream/);
  assert.equal(hub.subscriberCount(incidentId), 1);
  const entryResponse = await request(fixture.app).post(`/api/incidents/${incidentId}/entries`).set('Cookie', ownerCookie).send({ kind: 'timeline', body_md: 'streamed entry' });
  assert.equal(entryResponse.status, 201);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('stream event timeout')), 500);
    const check = () => {
      if (stream.getBody().includes('event: entry.created') && stream.getBody().includes(entryResponse.body.entry.id)) {
        clearTimeout(deadline); resolve();
      } else setTimeout(check, 5);
    };
    check();
  });
  stream.req.destroy();
  await new Promise((resolve) => {
    const check = () => hub.subscriberCount(incidentId) === 0 ? resolve() : setTimeout(check, 5);
    check();
  });
  assert.equal(hub.subscriberCount(incidentId), 0);
  const denied = await new Promise((resolve, reject) => {
    const req = http.request({ port, path: `/api/incidents/${incidentId}/stream`, headers: { Cookie: otherCookie } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(denied.res.statusCode, 404);
  assert.notEqual(denied.res.headers['content-type'], 'text/event-stream');
  assert.equal(hub.subscriberCount(incidentId), 0);
});

test('bare-id reads preserve unauthenticated and guard-storage statuses', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const owner = await register(fixture.app, 'guard-status-owner@example.test', 'Owner');
  const workspace = await owner.post('/api/workspaces').send({ name: 'Guard statuses' });
  const incident = await owner.post(`/api/workspaces/${workspace.body.workspace.id}/incidents`).send({ title: 'Guarded', severity: 'low' });
  const entry = await owner.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'guarded entry' });
  const anonymousIncident = await request(fixture.app).get(`/api/incidents/${incident.body.incident.id}`);
  const anonymousIncidentMissing = await request(fixture.app).get('/api/incidents/does-not-exist');
  const anonymousEntry = await request(fixture.app).get(`/api/entries/${entry.body.entry.id}`);
  const anonymousEntryMissing = await request(fixture.app).get('/api/entries/does-not-exist');
  const anonymousStream = await request(fixture.app).get(`/api/incidents/${incident.body.incident.id}/stream`);
  const anonymousStreamMissing = await request(fixture.app).get('/api/incidents/does-not-exist/stream');
  assert.equal(anonymousIncident.status, 401);
  assert.equal(anonymousIncidentMissing.status, 401);
  assert.equal(anonymousEntry.status, 401);
  assert.equal(anonymousEntryMissing.status, 401);
  assert.equal(anonymousStream.status, 401);
  assert.equal(anonymousStreamMissing.status, 401);
  assert.notEqual(anonymousStream.headers['content-type'], 'text/event-stream');
  assert.equal(hub.subscriberCount(incident.body.incident.id), 0);

  const originalPrepare = fixture.db.prepare.bind(fixture.db);
  fixture.db.prepare = (sql) => {
    if (String(sql).includes('FROM memberships')) throw new Error('membership storage unavailable');
    return originalPrepare(sql);
  };
  const failedGuard = await owner.get(`/api/incidents/${incident.body.incident.id}`);
  fixture.db.prepare = originalPrepare;
  assert.equal(failedGuard.status, 403);
  assert.equal(hub.subscriberCount(incident.body.incident.id), 0);
});

test('incident stream caps concurrent subscriptions per session', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const ownerRegistration = await request(fixture.app).post('/api/auth/register').send({
    email: 'stream-cap@example.test', name: 'Owner', password: 'round2a-password',
  });
  const ownerCookie = ownerRegistration.headers['set-cookie'][0].split(';')[0];
  const workspace = await request(fixture.app).post('/api/workspaces').set('Cookie', ownerCookie).send({ name: 'Stream cap' });
  const incident = await request(fixture.app).post(`/api/workspaces/${workspace.body.workspace.id}/incidents`).set('Cookie', ownerCookie).send({ title: 'Cap', severity: 'low' });
  const incidentId = incident.body.incident.id;
  const server = await new Promise((resolve) => {
    const value = fixture.app.listen(0, () => resolve(value));
  });
  t.after(() => server.close());
  const port = server.address().port;

  const streams = [];
  for (let i = 0; i < 5; i++) {
    const req = await new Promise((resolve, reject) => {
      const req = http.request({ port, path: `/api/incidents/${incidentId}/stream`, headers: { Cookie: ownerCookie }, agent: false }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'], /^text\/event-stream/);
        resolve(req);
      });
      req.on('error', reject);
      req.end();
    });
    streams.push(req);
  }
  const rejected = await new Promise((resolve, reject) => {
    const req = http.request({ port, path: `/api/incidents/${incidentId}/stream`, headers: { Cookie: ownerCookie }, agent: false }, (res) => {
      resolve({ res });
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(rejected.res.statusCode, 503);
  assert.notEqual(rejected.res.headers['content-type'], 'text/event-stream');
  for (const req of streams) req.destroy();
  await new Promise((resolve) => {
    const check = () => hub.subscriberCount(incidentId) === 0 ? resolve() : setTimeout(check, 5);
    check();
  });
});
