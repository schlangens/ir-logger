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

// Round 2 fills in the five routers below one work package at a time (PRs
// #4-#8). Before a given PR lands, `require`-ing its route module returns an
// empty `express.Router()` with zero routes registered, so every path under
// it falls through to src/server.js's own `/api` catch-all and answers
// `404 { error: 'Not found' }`. After the PR lands, the module has real
// routes and an unauthenticated request gets whatever SPEC.md §5 documents
// for that path — `401` for the session-guarded routes here, or `/api/demo`'s
// own no-auth success/rate-limit outcomes (SPEC.md §5.3, Auth: none). Both
// answers are correct, real responses from THIS app; only Express's own
// uncaught, default HTML 404 (which would show up if the whole `/api`
// catch-all itself went missing) is not. Do NOT revert this back to a single
// bare `404` expectation — a real, implemented route legitimately returns
// `401` to an unauthenticated caller, and asserting `404` again would just
// make this test fail on every Round 2 PR the moment it lands, for no
// reason: that's the exact bug this rewrite fixes.
//
// A plain status/JSON check on these paths *cannot* tell "router mounted but
// still an empty placeholder" apart from "router never mounted at all" —
// both fall through to the same `/api` catch-all and produce an identical
// 404 response (verified: commenting out one of the `app.use('/api',
// require('./routes/...'))` lines in src/server.js does not change the HTTP
// response at all while the router is still empty). So "genuinely mounted"
// is proven directly instead: the actual router module object returned by
// `require` must be present as a live layer in *this* app instance's
// middleware stack. That check still fails immediately if a mount line is
// removed from src/server.js, in either phase.
test('Round 2 API routers are mounted and answer this app\'s own JSON contract', async (t) => {
  const request = require('supertest');
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => {
    app.locals.sessionStore.stopCleanup();
    db.close();
  });

  const cases = [
    {
      label: 'incidents',
      modulePath: '../../src/routes/incidents',
      method: 'get',
      path: '/api/incidents/x',
      // SPEC.md §5.4 GET /api/incidents/:id — Auth: session (member)
      statuses: [404, 401],
    },
    {
      label: 'techniques',
      modulePath: '../../src/routes/techniques',
      method: 'get',
      path: '/api/techniques',
      // SPEC.md §5.6 GET /api/techniques — Auth: session
      statuses: [404, 401],
    },
    {
      label: 'evidence',
      modulePath: '../../src/routes/evidence',
      method: 'get',
      path: '/api/incidents/x/evidence',
      // SPEC.md §5.7 GET /api/incidents/:id/evidence — Auth: session (member)
      statuses: [404, 401],
    },
    {
      label: 'export',
      modulePath: '../../src/routes/export',
      method: 'get',
      path: '/api/incidents/x/export.pdf',
      // SPEC.md §5.9 GET /api/incidents/:id/export.pdf — Auth: session (member)
      statuses: [404, 401],
    },
    {
      label: 'demo',
      modulePath: '../../src/routes/demo',
      method: 'post',
      path: '/api/demo',
      // SPEC.md §5.3 POST /api/demo — Auth: none, but a same-origin check
      // denies cross-site requests (403). With a same-origin request it
      // succeeds (201), or the route's own fail-closed rate-limit outcomes
      // (429 over the per-IP cap, 503 if the limiter's storage can't be
      // evaluated, per §8.3).
      statuses: [404, 201, 403, 429, 503],
    },
  ];

  for (const { label, modulePath, method, path, statuses } of cases) {
    const routerModule = require(modulePath);
    assert.ok(
      app.router.stack.some((layer) => layer.handle === routerModule),
      `${label} router (${modulePath}) is not mounted on the app`,
    );

    const res = await request(app)[method](path);
    assert.match(
      res.headers['content-type'] || '',
      /^application\/json/,
      `${label} (${path}) did not answer with this app's JSON error handling`,
    );
    assert.ok(
      statuses.includes(res.status),
      `${label} (${path}) returned ${res.status}, expected one of ${statuses.join(', ')}`,
    );
  }
});
