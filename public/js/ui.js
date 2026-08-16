export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const STATUSES = ['open', 'contained', 'eradicated', 'recovered', 'closed'];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class' || k === 'className') {
      if (Array.isArray(v)) el.className = v.filter(Boolean).join(' ');
      else if (v) el.className = v;
    } else if (k.startsWith('data-')) {
      const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[key] = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'ariaLabel') {
      el.setAttribute('aria-label', v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (v !== undefined && v !== null) {
      if (v === false) {
        const booleans = new Set(['selected','checked','disabled','readonly','required','hidden','autofocus','multiple','open','reversed']);
        if (booleans.has(k)) el.removeAttribute(k);
        else el.setAttribute(k, v);
      } else {
        el.setAttribute(k, v);
      }
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) {
      el.append(...child);
    } else if (typeof child === 'string' || typeof child === 'number') {
      el.append(document.createTextNode(String(child)));
    } else {
      el.append(child);
    }
  }
  return el;
}

export function formatUtc(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function formatRelative(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatUtc(ts);
}

export function escapeHtml(value) {
  const text = String(value ?? '');
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#39;';
    else if (ch === '(') out += '&#40;';
    else if (ch === ')') out += '&#41;';
    else out += ch;
  }
  return out;
}

export function attrEscape(value) {
  const text = String(value ?? '');
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#39;';
    else out += ch;
  }
  return out;
}

export function severityIcon(severity) {
  const id = severity === 'critical'
    ? 'icon-critical'
    : severity === 'high'
    ? 'icon-high'
    : severity === 'medium'
    ? 'icon-medium'
    : 'icon-low';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons/severity.svg#${id}`);
  svg.append(use);
  return svg;
}

export function severityPill(severity) {
  const label = (severity || 'low').toUpperCase();
  const pill = document.createElement('span');
  pill.className = `pill pill--${severity || 'low'}`;
  pill.append(severityIcon(severity), ` ${label}`);
  return pill;
}

export function statusPill(status) {
  const label = (status || 'open').toUpperCase();
  const pill = document.createElement('span');
  pill.className = `pill pill--status pill--status-${status || 'open'}`;
  pill.textContent = label;
  return pill;
}

export function statusClass(status) {
  return `pill--status-${status || 'open'}`;
}

export function toast(message, type = 'info') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.append(stack);
  }
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast--${type}`;
  toastEl.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const close = h('button', { class: 'icon-btn toast__close', ariaLabel: 'Dismiss notification' }, '×');
  close.addEventListener('click', () => toastEl.remove());
  toastEl.append(text, close);
  stack.append(toastEl);
  if (type !== 'error') {
    setTimeout(() => toastEl.remove(), 5000);
  }
  return toastEl;
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'state state--loading' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', {}, text)
  );
}

export function errorBox(message, retry) {
  const box = h('div', { class: 'state state--error' }, message);
  if (typeof retry === 'function') {
    const btn = h('button', { class: 'btn btn--secondary state__retry' }, 'Retry');
    btn.addEventListener('click', retry);
    box.append(btn);
  }
  return box;
}

export function rateLimitBox(retryAfter) {
  const text = retryAfter
    ? `Too many requests — try again in ${retryAfter}s.`
    : 'Too many requests — try again shortly.';
  return h('div', { class: 'state state--rate' }, text);
}

export function emptyState({ icon, title, description, action }) {
  const wrapper = h('div', { class: 'empty-state' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '48');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons/empty-states.svg#${icon}`);
  svg.append(use);
  wrapper.append(
    svg,
    h('h3', {}, title),
    h('p', {}, description),
  );
  if (action) wrapper.append(action);
  return wrapper;
}

export function uiIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons/ui.svg#${name}`);
  svg.append(use);
  return svg;
}

export function select({ options, value, onChange, label }) {
  const sel = h('select', { class: 'form__select' });
  for (const [k, v] of options) {
    const opt = h('option', { value: k }, v);
    if (k === value) opt.selected = true;
    sel.append(opt);
  }
  if (label) sel.setAttribute('aria-label', label);
  sel.addEventListener('change', (e) => onChange && onChange(e.target.value));
  return sel;
}

export async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(String(value));
    toast('Copied to clipboard', 'success');
  } catch (e) {
    toast('Copy failed', 'error');
  }
}

export function buildUrl(path, params) {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url.pathname + url.search;
}

export function qs(el, selector) {
  return el.querySelector(selector);
}

export function qsa(el, selector) {
  return Array.from(el.querySelectorAll(selector));
}
