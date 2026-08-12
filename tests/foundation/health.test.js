const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { db: makeDb } = require('./helpers');
const { createApp } = require('../../src/server');

function close(app, db) {
  app.locals.sessionStore.stopCleanup();
  db.close();
}

test('health reports database status', async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.db, 'ok');
});

test('health returns 503 when SELECT 1 fails', async (t) => {
  const { db } = makeDb();
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql === 'SELECT 1') throw new Error('db down');
    return original(sql);
  };
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const response = await request(app).get('/health');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'error', db: 'error' });
});
