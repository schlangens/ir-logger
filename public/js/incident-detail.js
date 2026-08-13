import { initApp } from './app.js';
import { session, currentWorkspaceId, loadWorkspace, canEditIncident, canAddEntry, canUploadEvidence, canViewAudit } from './session.js';
import { getIncident, updateIncident, renderIncidentHeader } from './incidents.js';
import { listEntries, createEntry, renderTimeline, appendEntry, renderConnectionStatus, resetKnownEntries, setTechniqueMap } from './entries.js';
import { getMatrix, renderMatrix, searchTechniques } from './matrix.js';
import { listEvidence, uploadEvidence, renderEvidence } from './evidence.js';
import { renderAudit } from './audit.js';
import { connect, disconnect } from './sse.js';
import { h, loading, emptyState, errorBox, rateLimitBox, toast } from './ui.js';

let incident = null;
let incidentId = null;
let entries = [];
let currentTab = 'timeline';
let sseController = null;

function headerCallbacks() {
  return {
    canEdit: canEditIncident(),
    onSeverityChange: async (value) => {
      if (value === incident.severity) return;
      try {
        const data = await updateIncident(incident.id, { severity: value });
        incident = data.incident;
        updateHeader();
      } catch (e) { toast(e.message || 'Update failed', 'error'); }
    },
    onStatusChange: async (value) => {
      if (value === incident.status) return;
      try {
        const data = await updateIncident(incident.id, { status: value });
        incident = data.incident;
        updateHeader();
      } catch (e) { toast(e.message || 'Update failed', 'error'); }
    },
  };
}

function renderIncidentHeaderAndExports(header) {
  header.innerHTML = '';
  renderIncidentHeader(header, incident, headerCallbacks());

  const exportWrap = h('div', { class: 'incident__pills mt-3' });
  exportWrap.append(
    h('a', { class: 'btn btn--secondary', href: `/api/incidents/${incident.id}/export.pdf` }, 'Export PDF'),
    h('a', { class: 'btn btn--secondary', href: `/api/incidents/${incident.id}/export.md` }, 'Export Markdown')
  );
  header.append(exportWrap);
}

function updateHeader() {
  const header = document.querySelector('.incident__header');
  if (header) renderIncidentHeaderAndExports(header);
}

async function loadTechniques() {
  try {
    const data = await searchTechniques('');
    const map = new Map();
    for (const t of data.techniques || []) map.set(t.id, t);
    setTechniqueMap(map);
  } catch (e) {}
}

async function loadIncident() {
  const params = new URLSearchParams(window.location.search);
  incidentId = params.get('id');
  if (!incidentId) {
    window.location.href = '/app/dashboard.html';
    return;
  }

  const main = document.querySelector('main');
  main.innerHTML = '';
  main.append(loading('Loading incident…'));

  try {
    const data = await getIncident(incidentId);
    incident = data.incident;
    if (incident.workspace_id) {
      try { await loadWorkspace(incident.workspace_id); } catch (e) {}
    }
    localStorage.setItem(`last-viewed-${incident.id}`, new Date().toISOString());
    renderPage(main);
    await loadTab('timeline');
    startSse();
  } catch (e) {
    main.innerHTML = '';
    if (e.status === 404 || e.status === 403) {
      main.append(h('div', { class: 'page' },
        emptyState({
          icon: 'document',
          title: 'Not found',
          description: 'That incident does not exist or you do not have access to it.',
        })
      ));
    } else {
      main.append(h('div', { class: 'page' }, errorBox(e.message || 'Could not load incident.', () => loadIncident())));
    }
  }
}

function renderPage(main) {
  main.innerHTML = '';
  const page = h('div', { class: 'page' });

  const header = h('header', { class: 'incident__header' });
  renderIncidentHeaderAndExports(header);

  const tabs = h('div', { class: 'incident__tabs', role: 'tablist' });
  const panels = {};

  const addTab = (key, label) => {
    const btn = h('button', {
      class: 'incident__tab',
      role: 'tab',
      'data-tab': key,
      'aria-selected': key === currentTab,
      'aria-controls': `panel-${key}`,
    }, label);
    btn.addEventListener('click', () => switchTab(key));
    tabs.append(btn);
    const panel = h('section', { class: `tab-panel${key === currentTab ? ' is-active' : ''}`, id: `panel-${key}`, role: 'tabpanel' });
    panels[key] = panel;
  };

  addTab('timeline', 'Timeline');
  addTab('matrix', 'Matrix');
  addTab('evidence', 'Evidence');
  if (canViewAudit()) addTab('audit', 'Audit');

  const content = h('div', { class: 'tab-content' });
  for (const key of Object.keys(panels)) content.append(panels[key]);

  page.append(header, tabs, content);
  main.append(page);
}

async function switchTab(key) {
  currentTab = key;
  const tabBtns = document.querySelectorAll('.incident__tab');
  const panels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.tab === key)));
  panels.forEach((p) => { p.classList.toggle('is-active', p.id === `panel-${key}`); });
  await loadTab(key);
}

async function loadTab(key) {
  const panel = document.getElementById(`panel-${key}`);
  if (!panel || panel.dataset.loaded === 'true') return;
  panel.innerHTML = '';

  if (key === 'timeline') {
    panel.append(loading('Loading timeline…'));
    try {
      const data = await listEntries(incident.id);
      entries = (data.entries || []).sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
      resetKnownEntries();
      const timelineWrap = h('div', {});
      const conn = h('div', { class: 'mb-3' });
      conn.append(renderConnectionStatus('connecting'));
      panel.innerHTML = '';
      panel.append(conn, timelineWrap);
      renderTimeline(timelineWrap, entries, {
        showComposer: canAddEntry(),
        onAdd: (body) => createEntry(incident.id, body),
        onError: (e) => toast(e.message || 'Entry failed', 'error'),
      });
      panel.dataset.loaded = 'true';
    } catch (e) {
      panel.innerHTML = '';
      panel.append(errorBox(e.message));
    }
  } else if (key === 'matrix') {
    await renderMatrix(panel, incident.id, { onError: (e) => toast(e.message, 'error') });
    panel.dataset.loaded = 'true';
  } else if (key === 'evidence') {
    panel.append(loading('Loading evidence…'));
    try {
      const data = await listEvidence(incident.id);
      panel.innerHTML = '';
      renderEvidence(panel, data.evidence || [], {
        canUpload: canUploadEvidence(),
        incidentId: incident.id,
        onUpload: (file) => uploadEvidence(incident.id, file),
        onError: (e) => toast(e.message, 'error'),
      });
      panel.dataset.loaded = 'true';
    } catch (e) {
      panel.innerHTML = '';
      panel.append(errorBox(e.message));
    }
  } else if (key === 'audit') {
    panel.innerHTML = '';
    renderAudit(panel, currentWorkspaceId(), { canVerify: canViewAudit() });
    panel.dataset.loaded = 'true';
  }
}

function startSse() {
  if (!incident || sseController) return;
  sseController = connect(incident.id, {
    onEntry: (entry) => {
      const timelineContainer = document.querySelector('#panel-timeline > div:nth-child(2)');
      if (timelineContainer) appendEntry(timelineContainer, entry, { isNew: true });
    },
    onIncidentUpdate: (data) => {
      if (data && data.changes) {
        Object.assign(incident, data.changes);
        updateHeader();
      }
    },
    onEvidence: () => {
      const panel = document.getElementById('panel-evidence');
      if (panel && currentTab === 'evidence') {
        panel.dataset.loaded = '';
        loadTab('evidence');
      }
    },
    onTechniqueTagged: () => {
      const panel = document.getElementById('panel-matrix');
      if (panel && currentTab === 'matrix') {
        panel.dataset.loaded = '';
        loadTab('matrix');
      }
    },
    onStatusChange: (status) => {
      const conn = document.querySelector('#panel-timeline .connection');
      if (conn) {
        conn.className = `connection connection--${status}`;
        conn.querySelector('span:last-child').textContent = status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Offline';
      }
    },
  });
}

export async function initIncidentDetail() {
  await initApp();
  disconnect();
  sseController = null;
  await loadTechniques();
  await loadIncident();
}

window.addEventListener('beforeunload', () => disconnect());
