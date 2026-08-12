const HEARTBEAT_INTERVAL_MS = 25000;
const channels = new Map();

function getChannel(incidentId) {
  let channel = channels.get(incidentId);
  if (!channel) {
    channel = { subscribers: new Set(), sequence: 0 };
    channels.set(incidentId, channel);
  }
  return channel;
}

function subscribe(incidentId, res, { heartbeatMs = HEARTBEAT_INTERVAL_MS } = {}) {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };
  if (typeof res.set === 'function') res.set(headers);
  else Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  res.flushHeaders?.();
  const channel = getChannel(incidentId);
  const subscriber = { res, cleanup: null };
  channel.subscribers.add(subscriber);
  const timer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      cleanup();
    }
  }, heartbeatMs);
  timer.unref();
  function cleanup() {
    clearInterval(timer);
    channel.subscribers.delete(subscriber);
    if (!channel.subscribers.size) channels.delete(incidentId);
  }
  subscriber.cleanup = cleanup;
  res.on('close', cleanup);
  return cleanup;
}

function broadcast(incidentId, type, data) {
  const channel = channels.get(incidentId);
  if (!channel) return;
  channel.sequence++;
  for (const subscriber of channel.subscribers) {
    try {
      subscriber.res.write(
        `event: ${type}\nid: ${channel.sequence}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    } catch (e) {
      subscriber.cleanup();
    }
  }
}

function subscriberCount(id) {
  return channels.get(id)?.subscribers.size || 0;
}
module.exports = {
  subscribe,
  broadcast,
  subscriberCount,
  HEARTBEAT_INTERVAL_MS,
};
