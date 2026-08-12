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
