const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, register } = require('../incidents/helpers');

test('search is workspace-scoped and safely accepts FTS punctuation', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const one = await register(fixture.app, 'search-one@example.test', 'One');
  const two = await register(fixture.app, 'search-two@example.test', 'Two');
  const w1 = (await one.post('/api/workspaces').send({ name: 'One' })).body.workspace.id;
  const w2 = (await two.post('/api/workspaces').send({ name: 'Two' })).body.workspace.id;
  const i1 = await one.post(`/api/workspaces/${w1}/incidents`).send({ title: 'One', severity: 'low' });
  const i2 = await two.post(`/api/workspaces/${w2}/incidents`).send({ title: 'Two', severity: 'low' });
  await one.post(`/api/incidents/${i1.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'isolated secret phrase' });
  await two.post(`/api/incidents/${i2.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'other content' });
  assert.equal((await two.get(`/api/workspaces/${w2}/search`).query({ q: 'isolated' })).body.results.length, 0);
  assert.equal((await one.get(`/api/workspaces/${w1}/search`).query({ q: '"foo" OR bar*-' + '"' })).status, 200);
});

test('search validates q and returns ranked documented result objects', async (t) => {
  const fixture = makeApp();
  t.after(fixture.close);
  const user = await register(fixture.app, 'search-shape@example.test', 'Searcher');
  const wid = (await user.post('/api/workspaces').send({ name: 'Search shape' })).body.workspace.id;
  const incident = await user.post(`/api/workspaces/${wid}/incidents`).send({ title: 'Search incident', severity: 'low' });
  await user.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'needle needle' });
  await user.post(`/api/incidents/${incident.body.incident.id}/entries`).send({ kind: 'timeline', body_md: 'needle' });
  assert.equal((await user.get(`/api/workspaces/${wid}/search`)).status, 400);
  assert.equal((await user.get(`/api/workspaces/${wid}/search`).query({ q: '   ' })).status, 400);
  const response = await user.get(`/api/workspaces/${wid}/search`).query({ q: 'needle' });
  assert.equal(response.status, 200);
  assert.ok(response.body.results.length >= 1);
  for (const result of response.body.results) {
    assert.deepEqual(Object.keys(result).sort(), ['entryId', 'incidentId', 'incidentRef', 'incidentTitle', 'rank', 'snippet'].sort());
    assert.equal(typeof result.snippet, 'string');
    assert.equal(typeof result.rank, 'number');
  }
  assert.ok(response.body.results.every((result, index, all) => index === 0 || all[index - 1].rank <= result.rank));
});
