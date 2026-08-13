import { get } from './api.js';
import { listEntries } from './entries.js';
import { h, formatUtc, loading, errorBox, rateLimitBox } from './ui.js';

export async function getMatrix(incidentId) {
  return get(`/api/incidents/${incidentId}/matrix`);
}

export async function searchTechniques(q) {
  return get('/api/techniques', { q });
}

function cellState(count) {
  if (!count) return 'unused';
  if (count === 1) return 'light';
  if (count <= 3) return 'medium';
  return 'heavy';
}

async function showCellPopover(incidentId, technique, entries) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-label', `Technique ${technique.id}`);

  const list = h('div', { class: 'card' });
  if (!entries.length) {
    list.append(h('p', { class: 'state state--empty' }, 'No entries tagged with this technique.'));
  } else {
    const ul = h('ul', { class: 'matrix__entries' });
    for (const entry of entries) {
      const body = entry.body_md ? entry.body_md.slice(0, 120).replace(/\n/g, ' ') : '';
      const li = h('li', { class: 'matrix__entry' },
        h('div', { class: 'entry__header' },
          h('span', { class: 'entry__author' }, entry.author_name || 'Unknown'),
          h('time', { class: 'entry__time' }, formatUtc(entry.occurred_at))
        ),
        h('p', { class: 'form__hint' }, body || '(empty)')
      );
      ul.append(li);
    }
    list.append(ul);
  }

  const header = h('div', { class: 'modal__header' },
    h('h2', { class: 'modal__title' }, technique.name || technique.id),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => dialog.close() }, '×')
  );
  const body = h('div', { class: 'modal__body' },
    h('p', {}, h('code', {}, technique.id), ' — ', technique.tactic || ''),
    technique.url ? h('p', {}, h('a', { href: technique.url, target: '_blank', rel: 'noopener noreferrer' }, 'View on MITRE ATT&CK')) : null,
    list
  );
  dialog.append(header, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

export async function renderMatrix(container, incidentId, { onError } = {}) {
  container.innerHTML = '';
  container.append(loading('Loading matrix…'));

  let data;
  try {
    data = await getMatrix(incidentId);
  } catch (e) {
    container.innerHTML = '';
    if (e.status === 429 || e.status === 503) {
      container.append(rateLimitBox(e.retryAfter));
    } else {
      container.append(errorBox(e.message));
    }
    if (onError) onError(e);
    return;
  }

  container.innerHTML = '';
  if (!data.tactics || !data.tactics.length) {
    container.append(errorBox('Matrix not available.'));
    return;
  }

  const allTactics = data.tactics;
  const maxRows = Math.max(...allTactics.map((t) => t.techniques.length));
  const maxCount = Math.max(1, ...allTactics.flatMap((t) => t.techniques.map((tech) => tech.count || 0)));

  const wrapper = h('div', { class: 'matrix' });
  const table = h('table', { role: 'grid', 'aria-label': 'ATT&CK coverage matrix' });
  const thead = h('thead');
  const trHead = h('tr');
  for (const t of allTactics) {
    trHead.append(h('th', { scope: 'col' }, t.tactic));
  }
  thead.append(trHead);
  table.append(thead);

  const tbody = h('tbody');
  for (let i = 0; i < maxRows; i++) {
    const tr = h('tr');
    for (const t of allTactics) {
      const tech = t.techniques[i];
      if (tech) {
        const count = tech.count || 0;
        const state = cellState(count);
        const cell = h('button', {
          class: ['matrix__cell', `matrix__cell--${state}`],
          type: 'button',
          'aria-label': `${tech.id} ${tech.name || ''}, ${count} tagged entries`,
        });
        cell.append(
          h('div', { class: 'matrix__cell__top' },
            h('span', { class: 'matrix__cell__id' }, tech.id),
            count ? h('span', { class: 'matrix__cell__count' }, String(count)) : null
          ),
          h('div', { class: 'matrix__cell__name' }, tech.name || '')
        );
        cell.addEventListener('click', async () => {
          try {
            const entryData = await listEntries(incidentId);
            const tagged = (entryData.entries || []).filter((e) => e.technique_ids && e.technique_ids.includes(tech.id));
            await showCellPopover(incidentId, tech, tagged);
          } catch (e) {
            if (onError) onError(e);
          }
        });
        const td = h('td', {});
        td.append(cell);
        tr.append(td);
      } else {
        const td = h('td', { class: 'matrix__placeholder', 'aria-hidden': 'true' });
        tr.append(td);
      }
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  container.append(wrapper);
}
