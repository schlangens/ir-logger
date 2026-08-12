const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');

test('boot schedules the demo sweeper once at fifteen minutes', (t) => {
  const { db } = makeDb();
  const original = global.setInterval;
  const calls = [];
  global.setInterval = (callback, interval) => {
    const handle = { unref() {}, callback, interval };
    calls.push(handle);
    return handle;
  };
  let app;
  try {
    app = createApp(db);
  } finally {
    global.setInterval = original;
  }
  t.after(() => {
    app.locals.sessionStore.stopCleanup();
    db.close();
  });
  const sweeperCalls = calls.filter((call) => call.interval === 15 * 60 * 1000);
  assert.equal(sweeperCalls.length, 1);
  const before = db.prepare('SELECT count(*) AS n FROM workspaces').get().n;
  assert.doesNotThrow(() => sweeperCalls[0].callback());
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspaces').get().n, before);
});

test('stub routers return JSON 404s', async (t) => {
  const request = require('supertest');
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => {
    app.locals.sessionStore.stopCleanup();
    db.close();
  });
  for (const path of [
    '/api/incidents',
    '/api/techniques',
    '/api/incidents/x/evidence',
    '/api/incidents/x/export.pdf',
  ]) {
    assert.equal((await request(app).get(path)).status, 404);
  }
  assert.equal((await request(app).post('/api/demo')).status, 404);
});
