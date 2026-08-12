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
