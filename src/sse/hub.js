const HEARTBEAT_INTERVAL_MS = 25000;
const channels = new Map();
let sequence = 0;
function subscribe(
  incidentId,
  res,
  { heartbeatMs = HEARTBEAT_INTERVAL_MS } = {},
) {
  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  if (typeof res.set === "function") res.set(headers);
  else
    Object.entries(headers).forEach(([name, value]) =>
      res.setHeader(name, value),
    );
  res.flushHeaders?.();
  let set = channels.get(incidentId);
  if (!set) {
    set = new Set();
    channels.set(incidentId, set);
  }
  set.add(res);
  const timer = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (e) {
      cleanup();
    }
  }, heartbeatMs);
  timer.unref();
  function cleanup() {
    clearInterval(timer);
    set.delete(res);
    if (!set.size) channels.delete(incidentId);
  }
  res.on("close", cleanup);
  return cleanup;
}
function broadcast(incidentId, type, data) {
  for (const res of channels.get(incidentId) || []) {
    try {
      res.write(
        `event: ${type}\nid: ${++sequence}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    } catch (e) {}
  }
}
function subscriberCount(id) {
  return channels.get(id)?.size || 0;
}
module.exports = {
  subscribe,
  broadcast,
  subscriberCount,
  HEARTBEAT_INTERVAL_MS,
};
