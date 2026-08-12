const test = require('node:test');
const assert = require('node:assert/strict');
const hub = require('../../src/sse/hub');

test('hub broadcasts, heartbeats on interval, and cleans up disconnects', async () => {
  const events = [];
  const listeners = {};
  const response = {
    set() {},
    flushHeaders() {},
    write(value) {
      events.push(value);
    },
    on(event, callback) {
      listeners[event] = callback;
    },
  };
  hub.subscribe('incident', response, { heartbeatMs: 15 });
  assert.equal(events.length, 0);
  assert.equal(hub.subscriberCount('incident'), 1);
  hub.broadcast('incident', 'entry.created', { id: 'entry' });
  assert.ok(events.some((event) => event.includes('event: entry.created')));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(events.some((event) => event.includes(': heartbeat')));
  listeners.close();
  assert.equal(hub.subscriberCount('incident'), 0);
});

test('SSE event ids are per-channel, not a global counter', () => {
  const responses = [];
  function makeResponse() {
    const res = { events: [] };
    res.set = () => {};
    res.flushHeaders = () => {};
    res.write = (value) => res.events.push(value);
    res.on = () => {};
    responses.push(res);
    return res;
  }
  const alpha = makeResponse();
  const beta = makeResponse();
  hub.subscribe('alpha', alpha, { heartbeatMs: 100000 });
  hub.subscribe('beta', beta, { heartbeatMs: 100000 });
  hub.broadcast('alpha', 'event', { id: 1 });
  hub.broadcast('beta', 'event', { id: 2 });
  hub.broadcast('alpha', 'event', { id: 3 });
  assert.match(alpha.events[0], /id: 1/);
  assert.match(beta.events[0], /id: 1/);
  assert.match(alpha.events[1], /id: 2/);
});
