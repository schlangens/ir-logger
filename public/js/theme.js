const STORAGE_KEY = 'ir-logger-theme';

export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    document.documentElement.setAttribute('data-theme', stored);
    return stored;
  }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = prefersDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
