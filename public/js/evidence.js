import { get, post, api } from './api.js';
import { h, formatUtc, uiIcon, toast, emptyState, loading, errorBox, rateLimitBox, copyToClipboard } from './ui.js';

export async function listEvidence(incidentId) {
  return get(`/api/incidents/${incidentId}/evidence`);
}

export async function getEvidence(evidenceId) {
  return get(`/api/evidence/${evidenceId}`);
}

export async function uploadEvidence(incidentId, file, entryId) {
  const form = new FormData();
  form.append('file', file);
  if (entryId) form.append('entry_id', entryId);
  return post(`/api/incidents/${incidentId}/evidence`, form);
}

export async function getCustody(evidenceId) {
  return get(`/api/evidence/${evidenceId}/custody`);
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateHash(hash) {
  if (!hash || hash.length < 16) return hash || '';
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function renderEvidenceCard(item, { canDownload = true }) {
  const card = h('article', { class: 'evidence-card' });

  const header = h('div', { class: 'evidence-card__header' });
  const title = h('h3', { class: 'evidence-card__title', title: item.filename }, item.filename);
  header.append(title);

  const meta = h('div', { class: 'evidence-card__meta' },
    `${formatBytes(item.size)} • uploaded ${formatUtc(item.uploaded_at)} by ${item.uploaded_by_name || item.uploaded_by || 'unknown'}`
  );

  const hashChip = h('div', { class: 'evidence-card__hash' },
    h('span', {}, truncateHash(item.sha256)),
    h('button', {
      class: 'icon-btn',
      'aria-label': 'Copy full SHA-256 hash',
      onClick: () => copyToClipboard(item.sha256),
    }, uiIcon('copy'))
  );

  const actions = h('div', { class: 'evidence-card__actions' });
  if (canDownload) {
    const download = h('a', { class: 'btn btn--secondary', href: `/api/evidence/${item.id}/download`, download: '' },
      uiIcon('download'),
      ' Download'
    );
    const view = h('a', { class: 'btn btn--ghost', href: `/api/evidence/${item.id}` }, 'View details');
    actions.append(download, view);
  }

  const custodyWrap = h('div', {});
  const custodyToggle = h('button', { class: 'btn btn--ghost', type: 'button' }, 'View custody trail');
  let loaded = false;
  custodyToggle.addEventListener('click', async () => {
    if (loaded) return;
    try {
      const data = await getCustody(item.id);
      const events = data.events || [];
      const ol = h('ol', { class: 'custody-list' });
      for (const ev of events) {
        ol.append(h('li', {},
          `${ev.action} by ${ev.actor_user_id || 'unknown'} `,
          h('time', {}, formatUtc(ev.at))
        ));
      }
      custodyWrap.append(ol);
      loaded = true;
      custodyToggle.textContent = 'Custody trail';
      custodyToggle.disabled = true;
    } catch (e) {
      toast('Could not load custody trail', 'error');
    }
  });
  custodyWrap.append(custodyToggle);

  card.append(header, meta, hashChip, actions, custodyWrap);
  return card;
}

export function renderEvidence(container, evidence = [], { canUpload = false, incidentId, onUpload, onError } = {}) {
  container.innerHTML = '';

  if (canUpload) {
    const uploadBox = h('div', { class: 'evidence__upload' });
    const input = h('input', { type: 'file', class: 'form__input', 'aria-label': 'Choose evidence file' });
    const status = h('div', { class: 'form__hint' });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Upload evidence');

    const form = h('form', { class: 'evidence__upload' },
      h('div', { class: 'form__group' },
        h('label', { class: 'form__label' }, 'Upload a file'),
        input
      ),
      status,
      submit
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.textContent = '';
      const file = input.files[0];
      if (!file) {
        status.textContent = 'Select a file first.';
        return;
      }
      submit.disabled = true;
      try {
        const result = await onUpload(file);
        status.textContent = 'Uploaded.';
        input.value = '';
        if (result && result.evidence) evidence.push(result.evidence);
      } catch (err) {
        if (err.status === 429 || err.status === 503) {
          status.replaceWith(rateLimitBox(err.retryAfter));
        } else if (err.status === 413 || err.status === 409) {
          status.textContent = err.message || 'Upload limit exceeded.';
        } else {
          status.textContent = err.message || 'Upload failed.';
        }
        if (onError) onError(err);
      } finally {
        submit.disabled = false;
      }
    });

    container.append(form);
  }

  if (!evidence.length) {
    container.append(emptyState({
      icon: 'folder',
      title: 'No evidence uploaded',
      description: 'Upload a file to start this incident\'s chain of custody.',
    }));
    return;
  }

  for (const item of evidence) {
    container.append(renderEvidenceCard(item, { canDownload: true }));
  }
}
