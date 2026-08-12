const test = require('node:test');
const assert = require('node:assert/strict');
const {
  makeContext,
  registerWorkspace,
  closeContext,
  grantDemoSession,
} = require('./helpers');

const EXPECTED_IDS = [
  'T1595', 'T1589', 'T1598', 'T1583', 'T1586', 'T1587', 'T1566', 'T1566.001',
  'T1566.002', 'T1190', 'T1078', 'T1059', 'T1059.001', 'T1204', 'T1204.002',
  'T1053', 'T1053.005', 'T1547', 'T1136', 'T1078.004', 'T1055', 'T1068', 'T1027',
  'T1070', 'T1070.004', 'T1562', 'T1003', 'T1003.001', 'T1110', 'T1552', 'T1082',
  'T1087', 'T1018', 'T1021', 'T1021.001', 'T1021.002', 'T1550', 'T1560', 'T1074',
  'T1074.001', 'T1071', 'T1071.001', 'T1105', 'T1572', 'T1041', 'T1567', 'T1029',
  'T1486', 'T1490', 'T1489',
];

test('lists the complete seeded technique reference set and applies filters', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const { agent } = await registerWorkspace(context.app);

  const all = await agent.get('/api/techniques');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.techniques.map((row) => row.id).sort(), [...EXPECTED_IDS].sort());

  const persistence = await agent.get('/api/techniques?tactic=Persistence');
  assert.equal(persistence.status, 200);
  assert.ok(persistence.body.techniques.length > 0);
  assert.ok(persistence.body.techniques.every((row) => row.tactic === 'Persistence'));

  const phishing = await agent.get('/api/techniques?q=PhIsH');
  assert.deepEqual(
    phishing.body.techniques.map((row) => row.id).sort(),
    ['T1566', 'T1566.001', 'T1566.002', 'T1598'].sort(),
  );

  const literalWildcard = await agent.get('/api/techniques?q=%25');
  assert.equal(literalWildcard.status, 200);
  assert.equal(literalWildcard.body.techniques.length, 0);
});

test('requires a session and accepts a demo workspace grant', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const unauthenticated = await require('supertest')(context.app).get('/api/techniques');
  assert.equal(unauthenticated.status, 401);

  const { agent, cookie, workspaceId } = await registerWorkspace(context.app);
  grantDemoSession(context.db, cookie, workspaceId);
  const response = await agent.get('/api/techniques');
  assert.equal(response.status, 200);
});

test('rejects non-string filter query parameters', async (t) => {
  const context = makeContext();
  t.after(() => closeContext(context));
  const { agent } = await registerWorkspace(context.app);
  assert.equal((await agent.get('/api/techniques?q=a&q=b')).status, 400);
  assert.equal((await agent.get('/api/techniques?tactic=a&tactic=b')).status, 400);
});
