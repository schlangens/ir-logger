import { get, post } from './api.js';
import { renderToHtml } from './markdown.mjs';
import { h, formatUtc, uiIcon, toast, emptyState, loading, errorBox, rateLimitBox } from './ui.js';

let knownIds = new Set();
let techniqueMap = new Map();

export function resetKnownEntries() {
  knownIds = new Set();
}

export async function listEntries(incidentId, since) {
  return get(`/api/incidents/${incidentId}/entries`, since ? { since, limit: 500 } : { limit: 500 });
}

export async function createEntry(incidentId, body) {
  return post(`/api/incidents/${incidentId}/entries`, body);
}

export function setTechniqueMap(map) {
  techniqueMap = map || new Map();
}

function timeAgoDiff(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime());
}

function showTechniquePopover(technique, anchor) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-label', `Technique ${technique.id}`);
  const header = h('div', { class: 'modal__header' },
    h('h2', { class: 'modal__title' }, technique.name || technique.id),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => dialog.close() }, '×')
  );
  const body = h('div', { class: 'modal__body' },
    h('p', {}, h('strong', {}, 'ID: '), h('code', {}, technique.id)),
    technique.tactic ? h('p', {}, h('strong', {}, 'Tactic: '), technique.tactic) : null,
    technique.url ? h('p', {}, h('a', { href: technique.url, target: '_blank', rel: 'noopener noreferrer' }, 'View on MITRE ATT&CK')) : null
  );
  dialog.append(header, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

function renderTechniqueChip(techniqueId, options = {}) {
  const info = techniqueMap.get(techniqueId);
  const main = h('button', { class: 'technique-chip__main', type: 'button' },
    h('span', { class: 'technique-chip__id' }, techniqueId),
    info ? h('span', { class: 'technique-chip__name' }, info.name) : null
  );
  if (info) {
    main.title = `${info.name} — ${info.tactic || 'MITRE ATT&CK'}`;
    main.addEventListener('click', () => showTechniquePopover(info, main));
  }
  const chip = h('span', { class: 'technique-chip' }, main);
  if (options.onRemove) {
    const remove = h('button', { class: 'technique-chip__remove', type: 'button', 'aria-label': `Remove ${techniqueId}` }, '×');
    remove.addEventListener('click', (e) => { e.stopPropagation(); options.onRemove(techniqueId); });
    chip.append(remove);
  }
  return chip;
}

function renderEntry(entry, { isNew = false } = {}) {
  const kind = entry.kind || 'note';
  const article = h('article', { class: `entry entry--${kind}${isNew ? ' entry--new' : ''}`, 'data-entry-id': entry.id });

  const header = h('div', { class: 'entry__header' });
  header.append(
    h('span', { class: 'entry__author' }, entry.author_name || 'Unknown'),
    h('span', { class: 'entry__kind' }, kind),
    h('time', { class: 'entry__time', datetime: entry.occurred_at }, formatUtc(entry.occurred_at))
  );
  if (entry.created_at && timeAgoDiff(entry.occurred_at, entry.created_at) > 5 * 60 * 1000) {
    header.append(h('span', { class: 'form__hint' }, `(logged ${formatUtc(entry.created_at)})`));
  }
  article.append(header);

  const body = h('div', { class: 'entry__body' });
  body.innerHTML = renderToHtml(entry.body_md);
  article.append(body);

  if (kind === 'technical' && entry.technique_ids && entry.technique_ids.length) {
    const tags = h('div', { class: 'entry__tags' });
    for (const id of entry.technique_ids) {
      tags.append(renderTechniqueChip(id));
    }
    article.append(tags);
  }

  if (isNew) {
    const dot = h('span', { class: 'entry__new-dot', 'aria-hidden': 'true' });
    const live = h('span', { class: 'sr-only' }, 'New entry');
    article.append(dot, live);
    setTimeout(() => {
      article.classList.remove('entry--new');
      dot.remove();
      live.remove();
    }, 10000);
  }

  return article;
}

export function renderTimeline(container, entries = [], { showComposer = false, onAdd, onError } = {}) {
  container.innerHTML = '';
  const timeline = h('div', { class: 'timeline' });

  if (showComposer) {
    timeline.append(renderComposer({ onAdd, onError }));
  }

  if (!entries.length) {
    timeline.append(emptyState({
      icon: 'document',
      title: 'No entries yet',
      description: 'Log the first finding to start this incident\'s timeline.',
      action: showComposer ? null : undefined,
    }));
    container.append(timeline);
    return;
  }

  for (const entry of entries) {
    knownIds.add(entry.id);
    timeline.append(renderEntry(entry));
  }
  container.append(timeline);
}

export function appendEntry(container, entry, { isNew = true } = {}) {
  if (knownIds.has(entry.id)) return;
  knownIds.add(entry.id);
  const timeline = container.querySelector('.timeline');
  if (!timeline) return;
  const empty = timeline.querySelector('.empty-state');
  if (empty) empty.remove();
  const article = renderEntry(entry, { isNew });
  timeline.append(article);
}

function renderComposer({ onAdd, onError }) {
  const kindSelect = h('select', { class: 'form__select', 'aria-label': 'Entry kind' });
  kindSelect.append(
    h('option', { value: 'technical' }, 'Technical'),
    h('option', { value: 'timeline' }, 'Timeline'),
    h('option', { value: 'note' }, 'Note')
  );

  const occurredInput = h('input', { class: 'form__input', type: 'datetime-local', 'aria-label': 'Occurred at (optional)' });
  const bodyInput = h('textarea', { class: 'form__textarea', placeholder: 'What happened? Markdown is supported: **bold**, *italic*, `code`, lists, and ## headings.' });

  const selected = [];
  const selectedWrap = h('div', { class: 'composer__selected' });
  const refreshSelected = () => {
    selectedWrap.innerHTML = '';
    for (const id of selected) {
      selectedWrap.append(renderTechniqueChip(id, {
        onRemove: (tid) => {
          const idx = selected.indexOf(tid);
          if (idx !== -1) selected.splice(idx, 1);
          refreshSelected();
        }
      }));
    }
  };

  const pickerWrap = h('div', { class: 'composer__row' });
  const pickerBtn = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Add techniques');
  pickerWrap.classList.add('is-hidden');
  pickerBtn.addEventListener('click', () => openTechniquePicker((id) => {
    if (!selected.includes(id)) {
      selected.push(id);
      refreshSelected();
    }
  }));
  pickerWrap.append(pickerBtn);

  const updateKind = () => {
    if (kindSelect.value === 'technical') {
      pickerWrap.classList.remove('is-hidden');
    } else {
      pickerWrap.classList.add('is-hidden');
      selected.length = 0;
      refreshSelected();
    }
  };
  kindSelect.addEventListener('change', updateKind);
  updateKind();

  const errorEl = h('div', { class: 'form__error', hidden: true });
  const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Add entry');

  const form = h('form', { class: 'composer' },
    h('div', { class: 'composer__row' },
      h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Kind'), kindSelect),
      h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Occurred at (optional)'), occurredInput)
    ),
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Notes'), bodyInput),
    pickerWrap,
    selectedWrap,
    errorEl,
    submit
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    if (!bodyInput.value.trim()) {
      errorEl.textContent = 'Notes are required.';
      errorEl.hidden = false;
      return;
    }
    const occurredAt = occurredInput.value
      ? new Date(occurredInput.value).toISOString()
      : new Date().toISOString();
    const body = {
      kind: kindSelect.value,
      body_md: bodyInput.value,
      occurred_at: occurredAt,
      technique_ids: kindSelect.value === 'technical' ? selected : [],
    };
    try {
      submit.disabled = true;
      const result = await onAdd(body);
      form.reset();
      selected.length = 0;
      refreshSelected();
      if (result && result.entry) knownIds.add(result.entry.id);
    } catch (err) {
      if (err.status === 429 || err.status === 503) {
        errorEl.replaceWith(rateLimitBox(err.retryAfter));
      } else {
        errorEl.textContent = err.message || 'Failed to add entry.';
        errorEl.hidden = false;
      }
      if (onError) onError(err);
    } finally {
      submit.disabled = false;
    }
  });

  return form;
}

async function openTechniquePicker(onSelect) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal--wide';
  dialog.setAttribute('aria-label', 'Select techniques');

  const search = h('input', { class: 'form__input', placeholder: 'Search by ID or name…' });
  const list = h('div', { class: 'card' });
  const results = [];

  const renderResults = (techniques) => {
    list.innerHTML = '';
    if (!techniques.length) {
      list.append(h('p', { class: 'state state--empty' }, 'No techniques match.'));
      return;
    }
    const ul = h('ul', { class: 'picker-list' });
    for (const t of techniques) {
      const btn = h('button', { class: 'picker-list__item', type: 'button' },
        h('code', {}, t.id), ' — ', t.name,
        h('span', { class: 'form__hint' }, ` ${t.tactic}`)
      );
      btn.addEventListener('click', () => { onSelect(t.id); dialog.close(); });
      ul.append(h('li', {}, btn));
    }
    list.append(ul);
  };

  const doSearch = async () => {
    list.innerHTML = '';
    list.append(loading('Searching…'));
    try {
      const data = await get('/api/techniques', { q: search.value.trim() });
      results.length = 0;
      results.push(...(data.techniques || []));
      for (const t of results) techniqueMap.set(t.id, t);
      renderResults(results);
    } catch (e) {
      list.innerHTML = '';
      list.append(errorBox(e.message));
    }
  };

  search.addEventListener('input', debounce(doSearch, 200));

  const header = h('div', { class: 'modal__header' },
    h('h2', { class: 'modal__title' }, 'Select technique'),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => dialog.close() }, '×')
  );
  const body = h('div', { class: 'modal__body' }, search, list);
  dialog.append(header, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  doSearch();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function renderConnectionStatus(status) {
  const label = status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Offline';
  const cls = `connection connection--${status}`;
  return h('span', { class: cls, role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'connection__dot' }),
    h('span', {}, label)
  );
}
