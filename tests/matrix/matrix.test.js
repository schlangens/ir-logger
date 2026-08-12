const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  makeContext,
  registerWorkspace,
  closeContext,
  incident,
  entry,
  tag,
} = require('../techniques/helpers');
const { TACTIC_ORDER } = require('../../src/services/matrix');

function flatten(body) {
  return body.tactics.flatMap((group) => group.techniques.map((technique) => ({
    ...technique,
    tactic: group.tactic,
  })));
}

test('returns the full zero-count matrix in the fixed tactic order', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const { agent, workspaceId, userId } = await registerWorkspace(context.app);
  incident(context.db, { id: 'incident-zero', workspaceId, userId });

  const response = await agent.get('/api/incidents/incident-zero/matrix');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.tactics.map((group) => group.tactic), TACTIC_ORDER);
  const techniques = flatten(response.body);
  assert.equal(techniques.length, 50);
  assert.ok(techniques.every((technique) => technique.count === 0));
});

test('counts distinct tagged entries only within the requested incident', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const first = await registerWorkspace(context.app, 'First');
  const second = await registerWorkspace(context.app, 'Second');
  incident(context.db, { id: 'incident-counted', workspaceId: first.workspaceId, userId: first.userId });
  incident(context.db, { id: 'incident-other', workspaceId: second.workspaceId, userId: second.userId });
  entry(context.db, { id: 'entry-a', incidentId: 'incident-counted', userId: first.userId });
  entry(context.db, { id: 'entry-b', incidentId: 'incident-counted', userId: first.userId });
  entry(context.db, { id: 'entry-other', incidentId: 'incident-other', userId: second.userId });
  tag(context.db, 'entry-a', 'T1566.001');
  tag(context.db, 'entry-b', 'T1566.001');
  tag(context.db, 'entry-b', 'T1003.001');
  tag(context.db, 'entry-other', 'T1566.001');

  const response = await first.agent.get('/api/incidents/incident-counted/matrix');
  assert.equal(response.status, 200);
  const techniques = flatten(response.body);
  assert.equal(techniques.find((technique) => technique.id === 'T1566.001').count, 2);
  assert.equal(techniques.find((technique) => technique.id === 'T1003.001').count, 1);
  assert.ok(techniques.filter((technique) => !['T1566.001', 'T1003.001'].includes(technique.id))
    .every((technique) => technique.count === 0));
});

test('enforces session, incident existence, and tenant isolation', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const owner = await registerWorkspace(context.app, 'Owner');
  const outsider = await registerWorkspace(context.app, 'Outsider');
  incident(context.db, { id: 'private-incident', workspaceId: owner.workspaceId, userId: owner.userId });

  assert.equal((await request(context.app).get('/api/incidents/private-incident/matrix')).status, 401);
  assert.equal((await outsider.agent.get('/api/incidents/private-incident/matrix')).status, 404);
  assert.equal((await owner.agent.get('/api/incidents/unknown/matrix')).status, 404);
  const crossTenant = await outsider.agent.get('/api/incidents/private-incident/matrix');
  assert.equal(Object.hasOwn(crossTenant.body, 'tactics'), false);
});

test('fails closed when incident workspace resolution throws', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const { agent } = await registerWorkspace(context.app);
  const originalPrepare = context.db.prepare.bind(context.db);
  context.db.prepare = (sql) => {
    if (String(sql).includes('SELECT workspace_id FROM incidents')) throw new Error('storage failure');
    return originalPrepare(sql);
  };
  const response = await agent.get('/api/incidents/any-id/matrix');
  assert.notEqual(response.status, 200);
  assert.equal(Object.hasOwn(response.body, 'tactics'), false);
});
