const router = require('express').Router();
const { nanoid } = require('nanoid');
const crypto = require('node:crypto');
const { requireUser, requireWorkspace } = require('../middleware/workspace-guard');
const audit = require('../services/audit');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const user = (u) => ({ id: u.id, email: u.email, name: u.name });
router.post('/workspaces', requireUser, (req, res, next) => {
  const db = req.app.locals.db;
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name || name.length > 200)
    return res.status(400).json({ error: 'Name is required' });
  try {
    const id = nanoid(16);
    db.transaction(() => {
      db.prepare('INSERT INTO workspaces(id,name) VALUES(?,?)').run(id, name);
      db.prepare("INSERT INTO memberships(user_id,workspace_id,role) VALUES(?,?, 'owner')").run(
        req.user.id,
        id,
      );
      audit.append(db, {
        workspaceId: id,
        actorUserId: req.user.id,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: id,
        payload: { name },
      });
    })();
    res.status(201).json({ workspace: { id, name, role: 'owner' } });
  } catch (e) {
    next(e);
  }
});
router.get('/workspaces', requireUser, (req, res, next) => {
  try {
    const rows = req.app.locals.db
      .prepare(
        'SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=?',
      )
      .all(req.user.id);
    res.json({ workspaces: rows });
  } catch (e) {
    next(e);
  }
});
router.get('/workspaces/:id', requireWorkspace({}), (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const w = db
      .prepare('SELECT id,name,is_demo,expires_at,created_at FROM workspaces WHERE id=?')
      .get(req.workspace.id);
    const members = db
      .prepare(
        'SELECT u.id AS user_id,u.email,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?',
      )
      .all(req.workspace.id);
    res.json({ workspace: { ...w, role: req.workspace.role }, members });
  } catch (e) {
    next(e);
  }
});
router.post(
  '/workspaces/:id/invite',
  requireUser,
  requireWorkspace({ roles: ['owner'] }),
  (req, res, next) => {
    const { email, role } = req.body || {};
    if (typeof email !== 'string' || email.length > 320 || !['analyst', 'viewer'].includes(role))
      return res.status(400).json({ error: 'Valid email and role are required' });
    try {
      const raw = nanoid(32),
        id = nanoid(16);
      req.app.locals.db
        .prepare(
          'INSERT INTO invites(id,workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          id,
          req.workspace.id,
          email.toLowerCase(),
          role,
          hash(raw),
          req.user.id,
          new Date(Date.now() + 7 * 86400000).toISOString(),
        );
      audit.append(req.app.locals.db, {
        workspaceId: req.workspace.id,
        actorUserId: req.user.id,
        action: 'invite.created',
        targetType: 'invite',
        targetId: id,
        payload: { email, role },
      });
      res.status(201).json({
        invite_url: `${process.env.BASE_URL || 'https://ir.scottslab.io'}/invite/${raw}`,
      });
    } catch (e) {
      next(e);
    }
  },
);
router.post('/invites/:token/accept', requireUser, (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const inv = db.prepare('SELECT * FROM invites WHERE token_hash=?').get(hash(req.params.token));
    if (!inv || inv.accepted_at || new Date(inv.expires_at) <= new Date())
      return res.status(404).json({ error: 'Invite not found' });
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(inv.email);
    if (!existing || existing.id !== req.user.id)
      return res.status(404).json({ error: 'Invite not found' });
    let membership;
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO memberships(user_id,workspace_id,role) VALUES(?,?,?)').run(
        req.user.id,
        inv.workspace_id,
        inv.role,
      );
      // Re-invites never upgrade an existing membership; return the stored role.
      membership = db
        .prepare('SELECT role FROM memberships WHERE user_id=? AND workspace_id=?')
        .get(req.user.id, inv.workspace_id);
      db.prepare('UPDATE invites SET accepted_at=? WHERE id=?').run(
        new Date().toISOString(),
        inv.id,
      );
      audit.append(db, {
        workspaceId: inv.workspace_id,
        actorUserId: req.user.id,
        action: 'invite.accepted',
        targetType: 'invite',
        targetId: inv.id,
        payload: {},
      });
    })();
    const w = db.prepare('SELECT id,name FROM workspaces WHERE id=?').get(inv.workspace_id);
    res.json({ workspace: { ...w, role: membership.role } });
  } catch (e) {
    next(e);
  }
});
router.post(
  '/workspaces/:id/tokens',
  requireUser,
  requireWorkspace({ roles: ['owner'] }),
  (req, res, next) => {
    if (typeof req.body?.name !== 'string' || !req.body.name || req.body.name.length > 200)
      return res.status(400).json({ error: 'Name is required' });
    try {
      const raw = nanoid(32),
        id = nanoid(16);
      req.app.locals.db
        .prepare(
          'INSERT INTO api_tokens(id,workspace_id,user_id,name,token_hash) VALUES(?,?,?,?,?)',
        )
        .run(id, req.workspace.id, req.user.id, req.body.name, hash(raw));
      audit.append(req.app.locals.db, {
        workspaceId: req.workspace.id,
        actorUserId: req.user.id,
        action: 'token.created',
        targetType: 'api_token',
        targetId: id,
        payload: { name: req.body.name },
      });
      res.status(201).json({ token: raw, token_id: id });
    } catch (e) {
      next(e);
    }
  },
);
router.get('/workspaces/:id/tokens', requireUser, requireWorkspace({ roles: ['owner'] }), (req, res, next) => {
  try {
    const rows = req.app.locals.db
      .prepare('SELECT id,name,created_at,last_used_at FROM api_tokens WHERE workspace_id=?')
      .all(req.workspace.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        last_used_at: r.last_used_at,
      }));
    res.json({ tokens: rows });
  } catch (e) {
    next(e);
  }
});
router.delete(
  '/workspaces/:id/tokens/:tokenId',
  requireUser,
  requireWorkspace({ roles: ['owner'] }),
  (req, res, next) => {
    try {
      const db = req.app.locals.db;
      const x = db
        .prepare('SELECT id FROM api_tokens WHERE id=? AND workspace_id=?')
        .get(req.params.tokenId, req.workspace.id);
      if (!x) return res.status(404).json({ error: 'Token not found' });
      db.transaction(() => {
        db.prepare('DELETE FROM api_tokens WHERE id=?').run(x.id);
        audit.append(db, {
          workspaceId: req.workspace.id,
          actorUserId: req.user.id,
          action: 'token.deleted',
          targetType: 'api_token',
          targetId: x.id,
          payload: {},
        });
      })();
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  },
);
module.exports = router;
