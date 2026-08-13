import { get, post, patch } from './api.js';
import { h, formatUtc, formatRelative, severityPill, statusPill } from './ui.js';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const STATUSES = ['open', 'contained', 'eradicated', 'recovered', 'closed'];

export async function listIncidents(workspaceId, filters = {}) {
  return get(`/api/workspaces/${workspaceId}/incidents`, filters);
}

export async function getIncident(incidentId) {
  return get(`/api/incidents/${incidentId}`);
}

export async function createIncident(workspaceId, body) {
  return post(`/api/workspaces/${workspaceId}/incidents`, body);
}

export async function updateIncident(incidentId, changes) {
  return patch(`/api/incidents/${incidentId}`, changes);
}

export function severityOptions() {
  return SEVERITIES.map((s) => [s, s.toUpperCase()]);
}

export function statusOptions() {
  return STATUSES.map((s) => [s, s.toUpperCase()]);
}

export function renderIncidentFilters({ onChange, values }) {
  const statusSel = h('select', { class: 'form__select', 'aria-label': 'Filter by status' });
  statusSel.append(h('option', { value: '' }, 'All statuses'));
  for (const s of STATUSES) {
    const opt = h('option', { value: s }, s.toUpperCase());
    if (values.status === s) opt.selected = true;
    statusSel.append(opt);
  }
  statusSel.addEventListener('change', () => onChange({ status: statusSel.value, severity: severitySel.value }));

  const severitySel = h('select', { class: 'form__select', 'aria-label': 'Filter by severity' });
  severitySel.append(h('option', { value: '' }, 'All severities'));
  for (const s of SEVERITIES) {
    const opt = h('option', { value: s }, s.toUpperCase());
    if (values.severity === s) opt.selected = true;
    severitySel.append(opt);
  }
  severitySel.addEventListener('change', () => onChange({ status: statusSel.value, severity: severitySel.value }));

  return h('div', { class: 'dashboard__filters' }, statusSel, severitySel);
}

function isNewSinceLastViewed(incident) {
  if (!incident.last_activity_at) return false;
  const stored = localStorage.getItem(`last-viewed-${incident.id}`);
  if (!stored) return true;
  return new Date(incident.last_activity_at) > new Date(stored);
}

export function markIncidentViewed(incidentId) {
  localStorage.setItem(`last-viewed-${incidentId}`, new Date().toISOString());
}

export function renderIncidentList(container, { incidents = [], total = 0, onSelect }) {
  container.innerHTML = '';
  if (!incidents.length) {
    container.append(h('p', { class: 'state state--empty' }, 'No incidents match the current filters.'));
    return;
  }

  const table = h('table', { class: 'table' });
  const thead = h('thead');
  thead.append(h('tr', {},
    h('th', {}, 'Ref'),
    h('th', {}, 'Title'),
    h('th', {}, 'Severity'),
    h('th', {}, 'Status'),
    h('th', {}, 'Entries'),
    h('th', {}, 'Last activity')
  ));
  table.append(thead);
  const tbody = h('tbody');

  for (const incident of incidents) {
    const isNew = isNewSinceLastViewed(incident);
    const tr = h('tr', { class: 'incident-row' });
    const link = h('a', { href: `/app/incident.html?id=${encodeURIComponent(incident.id)}` }, incident.title);
    const titleCell = h('td', {});
    if (isNew) {
      const dot = h('span', { class: 'incident-row__dot', 'aria-hidden': 'true' });
      const hidden = h('span', { class: 'sr-only' }, 'Updated since you last viewed');
      titleCell.append(dot, hidden, ' ');
    }
    titleCell.append(link);
    tr.append(
      h('td', { class: 'mono' }, incident.ref),
      titleCell,
      h('td', {}, severityPill(incident.severity)),
      h('td', {}, statusPill(incident.status)),
      h('td', {}, String(incident.entry_count || 0)),
      h('td', {}, formatRelative(incident.last_activity_at || incident.opened_at)),
    );
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      window.location.href = `/app/incident.html?id=${encodeURIComponent(incident.id)}`;
    });
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);

  const caption = h('p', { class: 'form__hint' }, `Showing ${incidents.length} of ${total}`);
  container.append(caption);
}

export function renderIncidentHeader(container, incident, { onSeverityChange, onStatusChange, canEdit }) {
  container.innerHTML = '';
  const titleRow = h('div', { class: 'incident__title-row' });
  const titleWrap = h('div', {});
  titleWrap.append(
    h('h1', { class: 'incident__title' }, incident.title),
    h('div', { class: 'incident__ref' }, incident.ref),
  );
  titleRow.append(titleWrap);

  const pills = h('div', { class: 'incident__pills' });
  if (canEdit) {
    const sevSelect = h('select', { class: 'form__select', 'aria-label': 'Severity' });
    for (const s of SEVERITIES) {
      const opt = h('option', { value: s }, s.toUpperCase());
      if (incident.severity === s) opt.selected = true;
      sevSelect.append(opt);
    }
    sevSelect.addEventListener('change', () => onSeverityChange(sevSelect.value));

    const statusSelect = h('select', { class: 'form__select', 'aria-label': 'Status' });
    for (const s of STATUSES) {
      const opt = h('option', { value: s }, s.toUpperCase());
      if (incident.status === s) opt.selected = true;
      statusSelect.append(opt);
    }
    statusSelect.addEventListener('change', () => onStatusChange(statusSelect.value));

    pills.append(sevSelect, statusSelect);
  } else {
    pills.append(severityPill(incident.severity), statusPill(incident.status));
  }
  titleRow.append(pills);

  const summary = h('p', { class: 'incident__summary' }, incident.summary || 'No summary.');

  container.append(titleRow, summary);
}
