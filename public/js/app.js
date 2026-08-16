import { initTheme, toggleTheme, currentTheme } from './theme.js';
import { session, loadSession, restoreWorkspace, setWorkspace, logout, currentWorkspaceId } from './session.js';
import { h, uiIcon, loading, errorBox } from './ui.js';
import { bindSearch } from './search.js';

function renderSearchDialog(workspaceId) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal modal--wide';
  dialog.setAttribute('aria-label', 'Search workspace');

  const input = h('input', {
    class: 'form__input',
    type: 'search',
    placeholder: 'Search across every incident…',
    'aria-label': 'Search query',
  });
  const results = h('div', {});

  const header = h('div', { class: 'modal__header' },
    h('h2', { class: 'modal__title' }, 'Search workspace'),
    h('button', { class: 'icon-btn', 'aria-label': 'Close search', onClick: () => dialog.close() }, '×')
  );
  const body = h('div', { class: 'modal__body' }, input, results);
  dialog.append(header, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  input.focus();
  bindSearch(input, results, workspaceId);
}

function renderUserMenu() {
  const initials = session.user && session.user.name
    ? session.user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'GU';

  const menu = h('div', { class: 'topbar__menu' });
  if (session.user) {
    menu.append(
      h('div', { class: 'form__hint topbar__menu-header' }, session.user.email),
      h('a', { href: '/app/settings.html' }, 'Workspace settings'),
      h('button', { type: 'button', onClick: () => logout() }, 'Sign out')
    );
  } else {
    menu.append(
      h('a', { href: '/login.html' }, 'Sign in'),
      h('a', { href: '/register.html' }, 'Create account')
    );
  }

  const avatar = h('button', { class: 'topbar__user', 'aria-label': 'User menu', 'aria-haspopup': 'true' });
  avatar.textContent = initials;
  avatar.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    avatar.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== avatar && !avatar.contains(e.target)) {
      menu.classList.remove('is-open');
      avatar.setAttribute('aria-expanded', 'false');
    }
  });

  return h('div', { class: 'relative' }, avatar, menu);
}

function renderWorkspaceSwitcher() {
  if (session.workspaces.length < 2) {
    const ws = session.workspace || session.workspaces[0];
    return h('span', { class: 'topbar__workspace' }, ws ? ws.name : '');
  }
  const select = h('select', { class: 'form__select', 'aria-label': 'Switch workspace' });
  for (const ws of session.workspaces) {
    const opt = h('option', { value: ws.id }, ws.name);
    if (String(ws.id) === String(currentWorkspaceId())) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    setWorkspace(select.value);
    window.location.href = '/app/dashboard.html';
  });
  return h('span', { class: 'topbar__workspace' }, 'Workspace:', select);
}

export async function initApp() {
  initTheme();
  await loadSession();
  await restoreWorkspace();

  const header = document.querySelector('header') || document.getElementById('topbar');
  if (!header) return session;

  header.innerHTML = '';
  header.className = 'topbar';
  header.setAttribute('role', 'banner');

  const wordmark = h('a', { class: 'topbar__wordmark', href: '/' }, 'Incident Logger');

  const searchDesktop = h('div', { class: 'topbar__search' });
  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Search…',
    'aria-label': 'Search this workspace',
  });
  searchInput.addEventListener('click', () => {
    const ws = currentWorkspaceId();
    if (ws) renderSearchDialog(ws);
  });
  searchDesktop.append(uiIcon('search'), searchInput);

  const mobileSearchBtn = h('button', { class: 'topbar__icon-btn topbar__mobile-search', 'aria-label': 'Search' }, uiIcon('search'));
  mobileSearchBtn.addEventListener('click', () => {
    const ws = currentWorkspaceId();
    if (ws) renderSearchDialog(ws);
  });

  const themeBtn = h('button', { class: 'topbar__icon-btn', 'aria-label': 'Toggle color theme' }, uiIcon('theme'));
  themeBtn.addEventListener('click', () => toggleTheme());

  const right = h('div', { class: 'topbar__right' }, mobileSearchBtn, themeBtn, renderUserMenu());

  header.append(wordmark, renderWorkspaceSwitcher(), h('div', { class: 'topbar__center' }, searchDesktop), right);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      const ws = currentWorkspaceId();
      if (ws) renderSearchDialog(ws);
    }
  });

  return session;
}
