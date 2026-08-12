const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('./helpers');
const { rateLimit, consume } = require('../../src/middleware/rate-limit');

test('rate limiter fails closed and never calls next on storage error', () => {
  const middleware = rateLimit({ bucket: 'test', max: 1, windowMs: 1000 });
  let status;
  let body;
  let called = false;
  middleware(
    {
      ip: '127.0.0.1',
      app: {
        locals: {
          db: {
            prepare() {
              throw new Error('storage');
            },
          },
        },
      },
    },
    {
      status(code) {
        status = code;
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
      set() {
        return this;
      },
    },
    () => {
      called = true;
    },
  );
  assert.equal(status, 503);
  assert.equal(body.error, 'Rate limiter unavailable');
  assert.equal(called, false);
});

test('consume increments within a fixed window', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  assert.equal(consume(db, { bucketKey: 'x:ip', max: 1, windowMs: 60000 }).allowed, true);
  assert.equal(consume(db, { bucketKey: 'x:ip', max: 1, windowMs: 60000 }).allowed, false);
});

test('consume purges stale windows without removing the current bucket', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const originalNow = Date.now;
  Date.now = () => originalNow() + 61000;
  t.after(() => {
    Date.now = originalNow;
  });
  const registrationWindow = Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
  const loginWindow = Math.floor(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000);
  db.prepare('INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, ?)').run(
    'registration:1.2.3.4',
    registrationWindow,
    4,
  );
  db.prepare('INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, ?)').run(
    'login:1.2.3.4',
    loginWindow - 15 * 60 * 1000,
    9,
  );
  const result = consume(db, {
    bucketKey: 'login:1.2.3.4',
    max: 5,
    windowMs: 15 * 60 * 1000,
  });
  assert.equal(result.count, 1);
  assert.equal(
    db
      .prepare('SELECT count FROM rate_limits WHERE bucket_key=? AND window_start=?')
      .get('login:1.2.3.4', loginWindow - 15 * 60 * 1000),
    undefined,
  );
  assert.equal(
    db
      .prepare('SELECT count FROM rate_limits WHERE bucket_key=? AND window_start=?')
      .get('login:1.2.3.4', loginWindow).count,
    1,
  );
  assert.equal(
    db
      .prepare('SELECT count FROM rate_limits WHERE bucket_key=? AND window_start=?')
      .get('registration:1.2.3.4', registrationWindow).count,
    4,
  );
});
