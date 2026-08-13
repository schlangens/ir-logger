import { get, post } from './api.js';

export const session = {
  user: null,
  workspaces: [],
  workspace: null,
  loading: true,
};

export function isLoggedIn() {
  return Boolean(session.user);
}

export function isDemo() {
  return session.workspace && session.workspace.is_demo;
}

export function role() {
  return session.workspace ? session.workspace.role : null;
}

function isOwnerOrAnalyst() {
  const r = role();
  return r === 'owner' || r === 'analyst';
}

export function canCreateIncident() {
  return isOwnerOrAnalyst();
}

export function canEditIncident() {
  return isOwnerOrAnalyst();
}

export function canAddEntry() {
  return isOwnerOrAnalyst();
}

export function canUploadEvidence() {
  return isOwnerOrAnalyst();
}

export function canViewAudit() {
  return role() === 'owner';
}

export function canInviteMembers() {
  if (isDemo()) return false;
  return role() === 'owner';
}

export function canManageTokens() {
  if (isDemo()) return false;
  return role() === 'owner';
}

export function canChangeWorkspaceSettings() {
  if (isDemo()) return false;
  return role() === 'owner';
}

export async function loadSession() {
  try {
    const data = await get('/api/auth/session', undefined, { noRedirect: true });
    session.user = data.user;
    session.workspaces = data.workspaces || [];
    session.loading = false;
    return session;
  } catch (e) {
    session.user = null;
    session.workspaces = [];
    session.loading = false;
    return session;
  }
}

export async function loadWorkspace(workspaceId) {
  const data = await get(`/api/workspaces/${workspaceId}`);
  session.workspace = data.workspace;
  return data;
}

export function setWorkspace(workspaceId) {
  const ws = session.workspaces.find((w) => String(w.id) === String(workspaceId));
  if (ws) {
    session.workspace = ws;
    localStorage.setItem('ir-logger-workspace', ws.id);
  }
  return session.workspace;
}

export function currentWorkspaceId() {
  return session.workspace ? session.workspace.id : null;
}

export async function logout() {
  try {
    await post('/api/auth/logout', {}, { noRedirect: true });
  } catch (e) {}
  session.user = null;
  session.workspaces = [];
  session.workspace = null;
  window.location.href = '/login.html';
}

export async function restoreWorkspace() {
  const stored = localStorage.getItem('ir-logger-workspace');
  const ws = session.workspaces.find((w) => String(w.id) === String(stored));
  if (ws) {
    try {
      await loadWorkspace(ws.id);
    } catch (e) {
      session.workspace = ws;
    }
    return;
  }
  if (stored) {
    try {
      await loadWorkspace(stored);
      return;
    } catch (e) {
      if (!session.user) {
        session.workspace = { id: stored };
      } else {
        localStorage.removeItem('ir-logger-workspace');
      }
    }
  }
  if (session.workspaces.length) {
    const first = session.workspaces[0];
    try {
      await loadWorkspace(first.id);
    } catch (e) {
      session.workspace = first;
    }
  }
}
