import { get } from './api.js';

let source = null;
let currentIncidentId = null;
let lastSeenId = null;
let reconnectTimer = null;
let offlineTimer = null;
let status = 'connecting';
let statusCallback = null;

function setStatus(next) {
  status = next;
  if (statusCallback) statusCallback(next);
}

function clearTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
}

async function backfill(incidentId, callbacks) {
  if (!incidentId) return;
  const since = lastSeenId || '';
  try {
    const data = await get(`/api/incidents/${incidentId}/entries`, { since, limit: 500 });
    const entries = data.entries || [];
    for (const entry of entries) {
      if (callbacks.onEntry) callbacks.onEntry(entry);
      if (entry.id && (!lastSeenId || entry.id > lastSeenId)) lastSeenId = entry.id;
    }
  } catch (e) {
    if (callbacks.onError) callbacks.onError(e);
  }
}

function scheduleReconnectWarning() {
  clearTimers();
  reconnectTimer = setTimeout(() => {
    setStatus('reconnecting');
    offlineTimer = setTimeout(() => {
      setStatus('offline');
    }, 30000);
  }, 2000);
}

export function connect(incidentId, callbacks = {}) {
  disconnect();
  currentIncidentId = incidentId;
  statusCallback = callbacks.onStatusChange || null;
  lastSeenId = callbacks.lastSeenId || null;
  setStatus('connecting');

  const url = `/api/incidents/${incidentId}/stream`;
  source = new EventSource(url, { withCredentials: true });

  source.onopen = () => {
    clearTimers();
    setStatus('live');
    backfill(incidentId, callbacks);
  };

  source.addEventListener('entry.created', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && (!lastSeenId || data.id > lastSeenId)) lastSeenId = data.id;
      if (callbacks.onEntry) callbacks.onEntry(data);
    } catch (e) {}
  });

  source.addEventListener('incident.updated', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (callbacks.onIncidentUpdate) callbacks.onIncidentUpdate(data);
    } catch (e) {}
  });

  source.addEventListener('entry.technique_tagged', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (callbacks.onTechniqueTagged) callbacks.onTechniqueTagged(data);
    } catch (e) {}
  });

  source.addEventListener('evidence.uploaded', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (callbacks.onEvidence) callbacks.onEvidence(data);
    } catch (e) {}
  });

  source.onerror = () => {
    if (!source || source.readyState === EventSource.CLOSED) {
      setStatus('offline');
      return;
    }
    scheduleReconnectWarning();
  };

  return { disconnect, getStatus: () => status };
}

export function disconnect() {
  clearTimers();
  if (source) {
    source.close();
    source = null;
  }
  currentIncidentId = null;
  lastSeenId = null;
  statusCallback = null;
  status = 'connecting';
}

export function currentStatus() {
  return status;
}
