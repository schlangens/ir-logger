import { get } from './api.js';
import { h, formatUtc, loading, emptyState, errorBox, rateLimitBox } from './ui.js';

export async function listAudit(workspaceId, { limit = 100, offset = 0 } = {}) {
  return get(`/api/workspaces/${workspaceId}/audit`, { limit, offset });
}

export async function verifyAudit(workspaceId) {
  return get(`/api/workspaces/${workspaceId}/audit/verify`);
}

function renderPayload(payload) {
  if (!payload) return '';
  if (typeof payload !== 'object') return String(payload);
  const text = Object.entries(payload)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');
  return text;
}

function renderAuditRow(entry) {
  const payload = renderPayload(entry.payload_json);
  return h('tr', {},
    h('td', { class: 'mono' }, formatUtc(entry.at)),
    h('td', {}, entry.action),
    h('td', {}, `${entry.target_type || ''} ${entry.target_id ? entry.target_id.slice(0, 8) : ''}`),
    h('td', { class: 'audit-table__payload mono' }, payload),
    h('td', { class: 'mono' }, entry.actor_user_id ? entry.actor_user_id.slice(0, 8) : '')
  );
}

export function renderAudit(container, workspaceId, { canVerify = false } = {}) {
  container.innerHTML = '';
  const resultBox = h('div', {});
  const tableWrap = h('div', { class: 'table-wrap' });

  const load = async () => {
    tableWrap.innerHTML = '';
    tableWrap.append(loading('Loading audit log…'));
    try {
      const data = await listAudit(workspaceId);
      tableWrap.innerHTML = '';
      const entries = data.entries || [];
      if (!entries.length) {
        tableWrap.append(emptyState({
          icon: 'clipboard',
          title: 'No audit events yet',
          description: 'Actions in this workspace will appear here as they happen.',
        }));
      } else {
        const table = h('table', { class: 'table audit-table' });
        const thead = h('thead', {}, h('tr', {},
          h('th', {}, 'At'),
          h('th', {}, 'Action'),
          h('th', {}, 'Target'),
          h('th', {}, 'Payload'),
          h('th', {}, 'Actor')
        ));
        const tbody = h('tbody');
        for (const entry of entries) tbody.append(renderAuditRow(entry));
        table.append(thead, tbody);
        tableWrap.append(table);
      }
    } catch (e) {
      tableWrap.innerHTML = '';
      if (e.status === 429 || e.status === 503) {
        tableWrap.append(rateLimitBox(e.retryAfter));
      } else {
        tableWrap.append(errorBox(e.message));
      }
    }
  };

  const verifyBtn = h('button', { class: 'btn btn--secondary' }, 'Verify integrity');
  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    resultBox.innerHTML = '';
    try {
      const data = await verifyAudit(workspaceId);
      if (data.valid) {
        resultBox.className = 'audit__result audit__result--ok';
        resultBox.textContent = `Chain intact — ${data.checked} events checked.`;
      } else {
        resultBox.className = 'audit__result audit__result--fail';
        resultBox.textContent = `Tampering detected at event ${data.broken_at_id}.`;
      }
    } catch (e) {
      resultBox.className = 'audit__result audit__result--fail';
      resultBox.textContent = e.message || 'Verification failed.';
    } finally {
      verifyBtn.disabled = false;
    }
  });

  const verifyWrap = h('div', { class: 'audit__verify' });
  if (canVerify) verifyWrap.append(verifyBtn);

  container.append(verifyWrap, resultBox, tableWrap);
  load();
}
