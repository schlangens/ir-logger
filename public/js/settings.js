import { get, post, del } from './api.js';
import { session, currentWorkspaceId, canInviteMembers, canManageTokens, isDemo } from './session.js';
import { h, formatUtc, copyToClipboard, toast, emptyState, loading, errorBox } from './ui.js';

async function getWorkspace() {
  const id = currentWorkspaceId();
  return get(`/api/workspaces/${id}`);
}

async function createInvite(email, role) {
  const id = currentWorkspaceId();
  return post(`/api/workspaces/${id}/invite`, { email, role });
}

async function createToken(name) {
  const id = currentWorkspaceId();
  return post(`/api/workspaces/${id}/tokens`, { name });
}

async function listTokens() {
  const id = currentWorkspaceId();
  return get(`/api/workspaces/${id}/tokens`);
}

async function revokeToken(tokenId) {
  const id = currentWorkspaceId();
  return del(`/api/workspaces/${id}/tokens/${tokenId}`);
}

function renderMembers(members) {
  const table = h('table', { class: 'table' });
  const thead = h('thead', {}, h('tr', {},
    h('th', {}, 'Name'),
    h('th', {}, 'Email'),
    h('th', {}, 'Role')
  ));
  const tbody = h('tbody');
  for (const m of members) {
    tbody.append(h('tr', {},
      h('td', {}, m.name),
      h('td', {}, m.email),
      h('td', {}, m.role)
    ));
  }
  table.append(thead, tbody);
  return table;
}

function renderInviteForm() {
  const email = h('input', { class: 'form__input', type: 'email', placeholder: 'colleague@example.com' });
  const role = h('select', { class: 'form__select' });
  for (const r of ['analyst', 'viewer']) {
    role.append(h('option', { value: r }, r));
  }
  const output = h('div', { class: 'form__hint' });
  const submit = h('button', { class: 'btn btn--primary' }, 'Create invite');

  const form = h('form', { class: 'card' },
    h('h3', {}, 'Invite a member'),
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Email'), email),
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Role'), role),
    output,
    submit
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    output.innerHTML = '';
    try {
      const data = await createInvite(email.value, role.value);
      const urlField = h('input', { class: 'form__input', value: data.invite_url, readonly: true });
      const copyBtn = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Copy');
      copyBtn.addEventListener('click', () => copyToClipboard(data.invite_url));
      output.append(h('p', {}, 'Invite URL (send this to them):'), urlField, copyBtn);
      form.reset();
    } catch (err) {
      output.textContent = err.message || 'Invite failed.';
    }
  });
  return form;
}

function renderTokenCard(token, onRevoke) {
  const card = h('div', { class: 'token-row' },
    h('div', {},
      h('strong', {}, token.name),
      h('div', { class: 'form__hint' }, `Created ${formatUtc(token.created_at)}${token.last_used_at ? ` • Last used ${formatUtc(token.last_used_at)}` : ''}`)
    ),
    h('button', { class: 'btn btn--danger', type: 'button', onClick: onRevoke }, 'Revoke')
  );
  return card;
}

function renderTokenSection() {
  const container = h('div', { class: 'card' });
  const listWrap = h('div', {});
  const newToken = h('div', { class: 'card' });

  const nameInput = h('input', { class: 'form__input', placeholder: 'Token name' });
  const output = h('div', { class: 'form__hint' });
  const createBtn = h('button', { class: 'btn btn--primary' }, 'Create token');
  const createForm = h('form', { class: '' },
    h('h3', {}, 'API tokens'),
    h('div', { class: 'form__group' }, h('label', { class: 'form__label' }, 'Name'), nameInput),
    output,
    createBtn
  );
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    output.innerHTML = '';
    try {
      const data = await createToken(nameInput.value);
      const field = h('input', { class: 'form__input', value: data.token, readonly: true });
      const copy = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Copy');
      copy.addEventListener('click', () => copyToClipboard(data.token));
      output.append(
        h('p', { class: 'state state--error' }, 'Copy this now — you won\'t see it again.'),
        field,
        copy
      );
      createForm.reset();
      loadTokens();
    } catch (err) {
      output.textContent = err.message || 'Token creation failed.';
    }
  });

  const loadTokens = async () => {
    listWrap.innerHTML = '';
    try {
      const data = await listTokens();
      const tokens = data.tokens || [];
      if (!tokens.length) {
        listWrap.append(emptyState({ icon: 'key', title: 'No API tokens', description: 'Create one to access this workspace programmatically.' }));
      } else {
        for (const t of tokens) {
          listWrap.append(renderTokenCard(t, async () => {
            try {
              await revokeToken(t.id);
              loadTokens();
            } catch (err) {
              toast(err.message || 'Revoke failed', 'error');
            }
          }));
        }
      }
    } catch (e) {
      listWrap.append(errorBox(e.message));
    }
  };

  newToken.append(createForm);
  container.append(newToken, listWrap);
  loadTokens();
  return container;
}

export async function initSettings() {
  const container = document.querySelector('main');
  if (!container) return;
  container.innerHTML = '';
  container.append(loading('Loading settings…'));

  try {
    const data = await getWorkspace();
    session.workspace = data.workspace;
    container.innerHTML = '';

    if (isDemo()) {
      container.append(h('p', { class: 'state state--error' }, 'Settings are not available in demo mode.'));
      return;
    }

    container.append(h('h1', {}, 'Workspace settings'));
    const grid = h('div', { class: 'settings__grid' });

    const membersCard = h('div', { class: 'settings__section' },
      h('h2', {}, 'Members'),
      renderMembers(data.members || [])
    );
    grid.append(membersCard);

    if (canInviteMembers()) {
      grid.append(renderInviteForm());
    }

    if (canManageTokens()) {
      grid.append(renderTokenSection());
    }

    container.append(grid);
  } catch (e) {
    container.innerHTML = '';
    container.append(errorBox(e.message));
  }
}
