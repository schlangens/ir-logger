import { get } from './api.js';
import { h, formatUtc, loading, emptyState, errorBox, rateLimitBox } from './ui.js';

export async function search(workspaceId, q) {
  return get(`/api/workspaces/${workspaceId}/search`, { q });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function renderSearchResult(result) {
  const item = h('article', { class: 'search-result' });
  const title = h('a', {
    class: 'search-result__title',
    href: `/app/incident.html?id=${encodeURIComponent(result.incident_id)}`,
  });
  title.textContent = result.incident_title || result.incident_ref;

  const ref = h('div', { class: 'incident__ref' }, result.incident_ref);
  const snippet = h('div', { class: 'search-result__snippet' });
  snippet.innerHTML = result.snippet;

  item.append(title, ref, snippet);
  return item;
}

export function bindSearch(input, resultsContainer, workspaceId) {
  if (!input || !resultsContainer || !workspaceId) return;

  const run = async (q) => {
    resultsContainer.innerHTML = '';
    q = q.trim();
    if (!q) {
      resultsContainer.append(emptyState({
        icon: 'search',
        title: 'Search this workspace',
        description: 'Find anything logged across every incident\'s timeline.',
      }));
      return;
    }
    resultsContainer.append(loading('Searching…'));
    try {
      const data = await search(workspaceId, q);
      resultsContainer.innerHTML = '';
      const results = data.results || [];
      if (!results.length) {
        resultsContainer.append(emptyState({
          icon: 'search',
          title: `No matches for “${q}”`,
          description: 'Try a different term, or check another workspace if you belong to more than one.',
        }));
        return;
      }
      for (const r of results) {
        resultsContainer.append(renderSearchResult(r));
      }
    } catch (e) {
      resultsContainer.innerHTML = '';
      if (e.status === 429 || e.status === 503) {
        resultsContainer.append(rateLimitBox(e.retryAfter));
      } else {
        resultsContainer.append(errorBox(e.message));
      }
    }
  };

  const debounced = debounce(() => run(input.value), 250);
  input.addEventListener('input', debounced);
  run(input.value);
}
