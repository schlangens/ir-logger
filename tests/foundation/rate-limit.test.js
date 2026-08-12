const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('./helpers');
const { rateLimit, consume, peek } = require('../../src/middleware/rate-limit');

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

test('peek reports the live count without incrementing it', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  consume(db, { bucketKey: 'peek:ip', max: 5, windowMs: 60000 });
  const result = peek(db, { bucketKey: 'peek:ip', max: 5, windowMs: 60000 });
  assert.equal(result.allowed, true);
  assert.equal(result.count, 1);
  assert.equal(
    db.prepare('SELECT count FROM rate_limits WHERE bucket_key=?').get('peek:ip').count,
    1,
  );
});

test('refund restores exactly one attempt and cannot underflow or remove the row', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const req = {
    ip: '127.0.0.1',
    app: { locals: { db } },
  };
  let nextCalled = false;
  const middleware = rateLimit({
    bucket: 'refund',
    max: 10,
    windowMs: 60000,
    countMode: 'refund-on-success',
  });
  middleware(
    req,
    {
      status() {
        return this;
      },
      json() {
        return this;
      },
      set() {
        return this;
      },
    },
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, true);
  consume(db, { bucketKey: 'refund:127.0.0.1', max: 10, windowMs: 60000 });
  req.rateLimit.refund();
  assert.equal(
    db.prepare('SELECT count FROM rate_limits WHERE bucket_key=?').get('refund:127.0.0.1').count,
    1,
  );
  req.rateLimit.refund();
  assert.equal(
    db.prepare('SELECT count FROM rate_limits WHERE bucket_key=?').get('refund:127.0.0.1').count,
    1,
  );
});
