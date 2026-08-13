const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { makeApp, register } = require('../incidents/helpers');
const hub = require('../../src/sse/hub');

test('entries tag technical entries, ignore timeline tags, and live-join author names', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'entry-owner@example.test', 'Original');
  const workspace = await user.post('/api/workspaces').send({ name: 'Entry workspace' });
  const incident = await user.post(`/api/workspaces/${workspace.body.workspace.id}/incidents`).send({ title: 'Entries', severity: 'medium' });
  const id = incident.body.incident.id;
  const technical = await user.post(`/api/incidents/${id}/entries`).send({ kind: 'technical', body_md: 'technical event', technique_ids: ['T1059'] });
  assert.equal(technical.status, 201);
  assert.deepEqual(technical.body.entry.technique_ids, ['T1059']);
  assert.equal(technical.body.entry.author_name, 'Original');
  const timeline = await user.post(`/api/incidents/${id}/entries`).send({ kind: 'timeline', body_md: 'timeline event', technique_ids: ['not-a-technique'] });
  assert.equal(timeline.status, 201);
  assert.deepEqual(timeline.body.entry.technique_ids, []);
  assert.equal((await user.get(`/api/incidents/${id}/entries`)).body.entries.every((entry) => entry.author_name === 'Original'), true);
  const uid = technical.body.entry.author_user_id;
  fixture.db.prepare('UPDATE users SET name=? WHERE id=?').run('Renamed', uid);
  assert.equal((await user.get(`/api/entries/${technical.body.entry.id}`)).body.entry.author_name, 'Renamed');
  assert.deepEqual((await user.get(`/api/incidents/${id}/entries`).query({ since: technical.body.entry.id })).body.entries.map((e) => e.id), [timeline.body.entry.id]);
});

test('v1 ingest authenticates by hash and auto-creates its incident', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'ingest-owner@example.test', 'Desktop owner');
  const workspace = await user.post('/api/workspaces').send({ name: 'Ingest workspace' });
  const workspaceId = workspace.body.workspace.id;
  const token = await user.post(`/api/workspaces/${workspaceId}/tokens`).send({ name: 'Desktop' });
  const response = await request(fixture.app)
    .post('/api/v1/ingest')
    .set('Authorization', `Bearer ${token.body.token}`)
    .send({ incident_ref: 'DESKTOP-1', kind: 'technical', category: 'Discovery', body: 'collected host data', author_name: 'workstation' });
  assert.equal(response.status, 201);
  const incident = fixture.db.prepare('SELECT title FROM incidents WHERE id=?').get(response.body.incident_id);
  assert.equal(incident.title, 'Synced from desktop');
  const entry = fixture.db.prepare('SELECT body_md FROM entries WHERE id=?').get(response.body.entry_id);
  assert.match(entry.body_md, /^\*\*Category:\*\* Discovery/);
  assert.match(entry.body_md, /Originally logged by: workstation \(desktop sync\)_$/);
});

test('v1 ingest validates incident_ref, body, category, occurred_at, and author_name', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'ingest-validation@example.test', 'Validator');
  const workspace = await user.post('/api/workspaces').send({ name: 'Ingest validation' });
  const workspaceId = workspace.body.workspace.id;
  const token = (await user.post(`/api/workspaces/${workspaceId}/tokens`).send({ name: 'Desktop' })).body.token;
  const base = { incident_ref: 'VALID', kind: 'timeline', body: 'valid body' };
  const send = (payload) => request(fixture.app).post('/api/v1/ingest').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal((await send({ ...base, incident_ref: 'invalid ref' })).status, 400);
  assert.equal((await send({ ...base, incident_ref: 'x'.repeat(65) })).status, 400);
  assert.equal((await send({ ...base, incident_ref: '' })).status, 400);
  assert.equal((await send({ ...base, body: '' })).status, 400);
  assert.equal((await send({ ...base, body: 'x'.repeat(50001) })).status, 400);
  assert.equal((await send({ ...base, category: 'x'.repeat(201) })).status, 400);
  assert.equal((await send({ ...base, occurred_at: 'not-a-date' })).status, 400);
  assert.equal((await send({ ...base, occurred_at: 'x'.repeat(5000) })).status, 400);
  const authorResponse = await send({ ...base, author_name: 'foo\nbar' });
  assert.equal(authorResponse.status, 201);
  const entry = fixture.db.prepare('SELECT body_md FROM entries WHERE id=?').get(authorResponse.body.entry_id);
  assert.ok(entry);
  assert.ok(!entry.body_md.includes('foo\nbar'), 'newlines must be stripped from author_name');
  assert.ok(entry.body_md.includes('Originally logged by: foobar (desktop sync)'));
});

test('entry creation validates body length and occurred_at', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'entry-validation@example.test', 'Validator');
  const wid = (await user.post('/api/workspaces').send({ name: 'Entry validation' })).body.workspace.id;
  const incident = await user.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Entry validation', severity: 'low' });
  const id = incident.body.incident.id;
  assert.equal((await user.post(`/api/incidents/${id}/entries`).send({ kind: 'timeline', body_md: 'x'.repeat(50001) })).status, 400);
  assert.equal((await user.post(`/api/incidents/${id}/entries`).send({ kind: 'timeline', body_md: 'bad date', occurred_at: 'not-a-date' })).status, 400);
  assert.equal((await user.post(`/api/incidents/${id}/entries`).send({ kind: 'timeline', body_md: 'bad date', occurred_at: 'x'.repeat(5000) })).status, 400);
  const withOffset = await user.post(`/api/incidents/${id}/entries`).send({ kind: 'timeline', body_md: 'offset', occurred_at: '2025-08-12T10:00:00.000+05:00' });
  assert.equal(withOffset.status, 201);
  assert.equal(withOffset.body.entry.occurred_at, '2025-08-12T05:00:00.000Z');
});

test('entry events preserve create then technique-tag order and reject unknown tags atomically', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'entry-events@example.test', 'Author');
  const wid = (await user.post('/api/workspaces').send({ name: 'Events' })).body.workspace.id;
  const incident = await user.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Events', severity: 'medium' });
  const events = [];
  const originalBroadcast = hub.broadcast;
  hub.broadcast = (...args) => events.push(args);
  t.after(() => { hub.broadcast = originalBroadcast; });
  const created = await user.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'technical', body_md: 'tagged', technique_ids: ['T1059', 'T1027'] });
  assert.equal(created.status, 201);
  assert.deepEqual(events.map((event) => event[1]), ['entry.created', 'entry.technique_tagged', 'entry.technique_tagged']);
  assert.deepEqual(events.slice(1).map((event) => event[2].techniqueId), ['T1059', 'T1027']);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM entry_techniques WHERE entry_id=?').get(created.body.entry.id).count, 2);
  const bad = await user.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'technical', body_md: 'bad', technique_ids: ['T-NOPE'] });
  assert.equal(bad.status, 400);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM entries WHERE body_md=?').get('bad').count, 0);
});

test('entry list kind and limit filters, validation, viewer denial, tenant isolation, and bare-id 404s', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const owner = await register(fixture.app, 'entry-filter-owner@example.test', 'Owner');
  const viewer = await register(fixture.app, 'entry-filter-viewer@example.test', 'Viewer');
  const other = await register(fixture.app, 'entry-filter-other@example.test', 'Other');
  const wid = (await owner.post('/api/workspaces').send({ name: 'Entry filters' })).body.workspace.id;
  const otherWid = (await other.post('/api/workspaces').send({ name: 'Other entries' })).body.workspace.id;
  const invite = await owner.post(`/api/workspaces/${wid}/invite`).send({ email: 'entry-filter-viewer@example.test', role: 'viewer' });
  await viewer.post(`/api/invites/${invite.body.invite_url.split('/').pop()}/accept`);
  const incident = await owner.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Entries', severity: 'low' });
  const otherIncident = await other.post(`/api/workspaces/${otherWid}/incidents`).send({ title: 'Other', severity: 'low' });
  const first = await owner.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'one' });
  const second = await owner.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'note', body_md: 'two' });
  assert.equal((await owner.get(`/api/incidents/${incident.body.incident.id}/entries`).query({ kind: 'note', limit: 1 })).body.entries.length, 1);
  assert.equal((await owner.get(`/api/incidents/${incident.body.incident.id}/entries`).query({ limit: 1 })).body.entries.length, 1);
  assert.equal((await owner.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: '' })).status, 400);
  assert.equal((await owner.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'null time', occurred_at: null })).status, 400);
  assert.equal((await viewer.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'nope' })).status, 403);
  const foreign = await other.post(`/api/incidents/${otherIncident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'foreign' });
  const crossTenant = await owner.get(`/api/entries/${foreign.body.entry.id}`);
  assert.equal(crossTenant.status, 404);
  assert.equal(crossTenant.body.error, 'Entry not found');
  const missingEntry = await owner.get('/api/entries/does-not-exist');
  assert.equal(missingEntry.status, 404);
  assert.deepEqual(missingEntry.body, crossTenant.body);
  assert.equal((await request(fixture.app).get(`/api/entries/${foreign.body.entry.id}`)).status, 401);
  assert.equal((await request(fixture.app).get('/api/entries/does-not-exist')).status, 401);
  assert.equal(first.body.entry.author_name, 'Owner');
  assert.equal(second.body.entry.author_name, 'Owner');
});

test('ingest rejects unknown tokens, validates before touching last_used_at, and enforces both fail-closed limiters', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const owner = await register(fixture.app, 'ingest-limits@example.test', 'Owner');
  const wid = (await owner.post('/api/workspaces').send({ name: 'Ingest limits' })).body.workspace.id;
  const tokenResponse = await owner.post(`/api/workspaces/${wid}/tokens`).send({ name: 'Sync' });
  const rawToken = tokenResponse.body.token;
  const tokenId = tokenResponse.body.token_id;
  const beforeRows = fixture.db.prepare('SELECT COUNT(*) AS count FROM incidents').get().count;
  const unknown = await request(fixture.app).post('/api/v1/ingest').set('Authorization', 'Bearer unknown-token').send({
    incident_ref: 'UNKNOWN', kind: 'timeline', body: 'ignored',
  });
  assert.equal(unknown.status, 401);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM incidents').get().count, beforeRows);
  const invalid = await request(fixture.app).post('/api/v1/ingest').set('Authorization', `Bearer ${rawToken}`).send({
    incident_ref: 'VALIDATION', kind: 'timeline', body: 'ignored', occurred_at: null,
  });
  assert.equal(invalid.status, 400);
  assert.equal(fixture.db.prepare('SELECT last_used_at FROM api_tokens WHERE id=?').get(tokenId).last_used_at, null);
  const incident = await owner.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Limit target', severity: 'low' });
  for (let i = 0; i < 58; i++) {
    const response = await request(fixture.app).post('/api/v1/ingest').set('Authorization', `Bearer ${rawToken}`).send({
      incident_ref: incident.body.incident.ref, kind: 'timeline', body: `entry ${i}`,
    });
    assert.equal(response.status, 201);
  }
  assert.equal((await request(fixture.app).post('/api/v1/ingest').set('Authorization', `Bearer ${rawToken}`).send({
    incident_ref: incident.body.incident.ref, kind: 'timeline', body: 'entry 59',
  })).status, 201);
  assert.equal((await request(fixture.app).post('/api/v1/ingest').set('Authorization', `Bearer ${rawToken}`).send({
    incident_ref: incident.body.incident.ref, kind: 'timeline', body: 'too many',
  })).status, 429);
  assert.ok(fixture.db.prepare('SELECT last_used_at FROM api_tokens WHERE id=?').get(tokenId).last_used_at);

  const otherFixture = makeApp();
  t.after(otherFixture.close);
  const otherOwner = await register(otherFixture.app, 'ingest-ip@example.test', 'Owner');
  const otherWid = (await otherOwner.post('/api/workspaces').send({ name: 'IP limit' })).body.workspace.id;
  const otherToken = (await otherOwner.post(`/api/workspaces/${otherWid}/tokens`).send({ name: 'Sync' })).body.token;
  for (let i = 0; i < 20; i++) {
    const response = await request(otherFixture.app).post('/api/v1/ingest').set('X-Forwarded-For', '198.51.100.22').set('Authorization', `Bearer bad-${i}`).send({
      incident_ref: `BAD-${i}`, kind: 'timeline', body: 'bad',
    });
    assert.equal(response.status, 401);
  }
  assert.equal((await request(otherFixture.app).post('/api/v1/ingest').set('X-Forwarded-For', '198.51.100.22').set('Authorization', 'Bearer bad-20').send({
    incident_ref: 'BAD-20', kind: 'timeline', body: 'bad',
  })).status, 429);
  assert.equal((await request(otherFixture.app).post('/api/v1/ingest').set('X-Forwarded-For', '198.51.100.22').set('Authorization', `Bearer ${otherToken}`).send({
    incident_ref: 'LOCKED', kind: 'timeline', body: 'locked',
  })).status, 429);

  const authFailureDb = fixture.db;
  const originalPrepare = authFailureDb.prepare.bind(authFailureDb);
  authFailureDb.prepare = (sql) => {
    if (String(sql).includes('rate_limits')) throw new Error('rate limiter unavailable');
    return originalPrepare(sql);
  };
  assert.equal((await request(fixture.app).post('/api/v1/ingest').set('Authorization', 'Bearer anything').send({
    incident_ref: 'FAIL', kind: 'timeline', body: 'fail',
  })).status, 503);
  authFailureDb.prepare = originalPrepare;

  let rateLimitStatements = 0;
  authFailureDb.prepare = (sql) => {
    if (String(sql).includes('rate_limits') && ++rateLimitStatements >= 2) throw new Error('token limiter unavailable');
    return originalPrepare(sql);
  };
  assert.equal((await request(fixture.app).post('/api/v1/ingest').set('Authorization', `Bearer ${rawToken}`).send({
    incident_ref: 'FAIL-TOKEN', kind: 'timeline', body: 'fail',
  })).status, 503);
  authFailureDb.prepare = originalPrepare;
});
