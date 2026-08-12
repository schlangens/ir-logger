function resolveWorkspaceAccess(db, req, workspaceId) {
  if (!workspaceId) return { ok: false, status: 404, error: 'Workspace not found' };
  const hasDemoGrant = req.session?.demoWorkspaceId === workspaceId;
  if (!req.user && !hasDemoGrant)
    return { ok: false, status: 401, error: 'Authentication required' };
  try {
    const workspace = db
      .prepare('SELECT id, is_demo, expires_at FROM workspaces WHERE id = ?')
      .get(workspaceId);
    if (!workspace) return { ok: false, status: 404, error: 'Workspace not found' };
    if (
      hasDemoGrant &&
      workspace.is_demo === 1 &&
      workspace.expires_at &&
      new Date(workspace.expires_at) > new Date()
    )
      return { ok: true, role: 'owner', isDemo: true };
    if (!req.user) return { ok: false, status: 401, error: 'Authentication required' };
    const membership = db
      .prepare('SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?')
      .get(req.user.id, workspaceId);
    if (!membership) return { ok: false, status: 404, error: 'Workspace not found' };
    return {
      ok: true,
      role: membership.role,
      isDemo: Boolean(workspace.is_demo),
    };
  } catch (error) {
    // Fail closed: storage errors never grant workspace access; this guard returns 403 per SPEC §8.2.
    return {
      ok: false,
      status: 403,
      error: 'Unable to resolve workspace access',
    };
  }
}

function resolveDemoActorId(db, workspaceId, sessionUserId) {
  if (sessionUserId) {
    const user = db.prepare('SELECT id, is_demo, email FROM users WHERE id = ?').get(sessionUserId);
    if (user && user.is_demo === 1 && user.email === `demo-${workspaceId}@demo.invalid`) {
      return user.id;
    }
  }
  const user = db
    .prepare("SELECT id FROM users WHERE is_demo = 1 AND email = 'demo-' || ? || '@demo.invalid'")
    .get(workspaceId);
  return user?.id || null;
}

function resolveActor(db, req, workspaceId) {
  if (req.user?.id) return { id: req.user.id };
  if (req.session?.demoWorkspaceId === workspaceId) {
    const actorId = resolveDemoActorId(db, workspaceId, req.session?.demoUserId);
    if (actorId) return { id: actorId };
  }
  return null;
}

function requireWorkspace({ param = 'id', roles } = {}) {
  return (req, res, next) => {
    const result = resolveWorkspaceAccess(req.app.locals.db, req, req.params[param]);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    if (roles && !roles.includes(result.role)) return res.status(403).json({ error: 'Forbidden' });
    const actor = resolveActor(req.app.locals.db, req, req.params[param]);
    if (!actor) return res.status(401).json({ error: 'Authentication required' });
    req.workspace = {
      id: req.params[param],
      role: result.role,
      isDemo: result.isDemo,
    };
    req.actor = actor;
    next();
  };
}

function requireSession(req, res, next) {
  if (req.user || req.session?.demoWorkspaceId) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

function requireUser(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = {
  resolveWorkspaceAccess,
  resolveActor,
  requireWorkspace,
  requireSession,
  requireUser,
};
