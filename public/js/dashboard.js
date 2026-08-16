import { initApp } from './app.js';
import { currentWorkspaceId, canCreateIncident, setWorkspace } from './session.js';
import { listIncidents, createIncident, SEVERITIES, renderIncidentFilters, renderIncidentList } from './incidents.js';
import { h, loading, emptyState, errorBox, rateLimitBox } from './ui.js';
import { post } from './api.js';

async function load(container, filters) {
  container.innerHTML = '';
  container.append(loading('Loading incidents…'));
  try {
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) throw new Error('No workspace selected.');
    const data = await listIncidents(workspaceId, filters);
    container.innerHTML = '';
    if (!data.incidents.length) {
      container.append(emptyState({
        icon: 'document',
        title: 'No incidents yet',
        description: 'Open one to start tracking findings, evidence, and timeline.',
      }));
    } else {
      renderIncidentList(container, { incidents: data.incidents, total: data.total, onSelect: (id) => { window.location.href = `/app/incident.html?id=${id}`; } });
    }
  } catch (e) {
    container.innerHTML = '';
    if (e.status === 429 || e.status === 503) {
      container.append(rateLimitBox(e.retryAfter));
    } else {
      container.append(errorBox(e.message, () => load(container, filters)));
    }
  }
}

function renderNewIncidentModal(workspaceId, onCreated) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-label', 'New incident');

  const title = h('input', { class: 'form__input', name: 'title', required: true });
  const summary = h('textarea', { class: 'form__textarea', name: 'summary' });
  const severity = h('select', { class: 'form__select', name: 'severity' });
  for (const s of SEVERITIES) {
    const opt = h('option', { value: s, selected: s === 'medium' }, s.toUpperCase());
    severity.append(opt);
  }
  const error = h('div', { class: 'form__error', hidden: true });

  const form = h('form', {},
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Title'), title),
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Summary'), summary),
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Severity'), severity),
    error
  );

  const cancel = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
  cancel.addEventListener('click', () => dialog.close());
  const submit = h('button', { class: 'btn btn--primary' }, 'Create incident');

  const footer = h('div', { class: 'modal__footer' }, cancel, submit);

  dialog.append(
    h('div', { class: 'modal__header' }, h('h2', { class: 'modal__title' }, 'New incident')),
    h('div', { class: 'modal__body' }, form),
    footer
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());

  submit.addEventListener('click', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const data = await createIncident(workspaceId, {
        title: title.value,
        summary: summary.value,
        severity: severity.value,
      });
      dialog.close();
      onCreated(data.incident);
    } catch (err) {
      if (err.status === 429 || err.status === 503) {
        error.replaceWith(rateLimitBox(err.retryAfter));
      } else {
        error.textContent = err.message || 'Could not create incident.';
        error.hidden = false;
      }
      submit.disabled = false;
    }
  });

  dialog.showModal();
  title.focus();
}

function renderCreateWorkspaceModal(onCreated) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-label', 'Create workspace');

  const name = h('input', { class: 'form__input', name: 'name', required: true });
  const error = h('div', { class: 'form__error', hidden: true });

  const form = h('form', {},
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Workspace name'), name),
    error
  );

  const cancel = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
  cancel.addEventListener('click', () => dialog.close());
  const submit = h('button', { class: 'btn btn--primary' }, 'Create workspace');

  const footer = h('div', { class: 'modal__footer' }, cancel, submit);
  dialog.append(
    h('div', { class: 'modal__header' }, h('h2', { class: 'modal__title' }, 'Create workspace')),
    h('div', { class: 'modal__body' }, form),
    footer
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());

  submit.addEventListener('click', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const data = await post('/api/workspaces', { name: name.value });
      setWorkspace(data.workspace.id);
      dialog.close();
      onCreated(data.workspace);
    } catch (err) {
      if (err.status === 429 || err.status === 503) {
        error.replaceWith(rateLimitBox(err.retryAfter));
      } else {
        error.textContent = err.message || 'Could not create workspace.';
        error.hidden = false;
      }
      submit.disabled = false;
    }
  });

  dialog.showModal();
  name.focus();
}

function renderNoWorkspace(container) {
  container.innerHTML = '';
  container.append(emptyState({
    icon: 'document',
    title: 'No workspace yet',
    description: 'Create a workspace to start tracking incidents.',
  }));
  const btn = h('button', { class: 'btn btn--primary' }, 'Create workspace');
  btn.addEventListener('click', () => renderCreateWorkspaceModal(() => { window.location.reload(); }));
  container.append(btn);
}

export async function initDashboard() {
  await initApp();
  const main = document.querySelector('main');
  if (!main) return;

  if (!currentWorkspaceId()) {
    main.innerHTML = '';
    renderNoWorkspace(main);
    return;
  }

  const filters = { status: '', severity: '' };
  const listContainer = h('div', {});
  const header = h('div', { class: 'dashboard__header' },
    h('h1', {}, 'Incidents'),
    canCreateIncident()
      ? h('button', { class: 'btn btn--primary', onClick: () => renderNewIncidentModal(currentWorkspaceId(), (incident) => {
          window.location.href = `/app/incident.html?id=${encodeURIComponent(incident.id)}`;
        }) }, 'New incident')
      : null
  );

  const filterContainer = h('div', {});
  filterContainer.append(renderIncidentFilters({
    onChange: (next) => { Object.assign(filters, next); load(listContainer, filters); },
    values: filters,
  }));

  main.append(header, filterContainer, listContainer);
  await load(listContainer, filters);
}
