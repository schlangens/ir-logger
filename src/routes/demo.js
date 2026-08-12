const router = require('express').Router();
const { rateLimit } = require('../middleware/rate-limit');
const seedDemoWorkspace = require('../services/demo-seed');

const CAPACITY_ERROR = 'Demo capacity unavailable';

function regenerate(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

function isSameOrigin(req) {
  const host = req.get('host');
  if (!host) return false;
  const originOrReferer = req.get('origin') || req.get('referer');
  if (!originOrReferer) return false;
  try {
    const { host: originHost } = new URL(originOrReferer);
    return originHost.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function requireSameOrigin(req, res, next) {
  if (isSameOrigin(req)) return next();
  return res.status(403).json({ error: 'Invalid origin' });
}

async function reuseExistingDemoGrant(req, res, next) {
  const existingWorkspaceId = req.session?.demoWorkspaceId;
  if (!existingWorkspaceId) return next();
  const db = req.app.locals.db;
  try {
    const workspace = db
      .prepare('SELECT id FROM workspaces WHERE id = ? AND is_demo = 1 AND expires_at > ?')
      .get(existingWorkspaceId, new Date().toISOString());
    if (!workspace) return next();
    const incident = db
      .prepare('SELECT id FROM incidents WHERE workspace_id = ? LIMIT 1')
      .get(existingWorkspaceId);
    if (!incident) return next();
    const user = db
      .prepare("SELECT id FROM users WHERE is_demo = 1 AND email = 'demo-' || ? || '@demo.invalid'")
      .get(existingWorkspaceId);
    if (!user) return next();
    await regenerate(req);
    req.session.demoWorkspaceId = existingWorkspaceId;
    req.session.demoUserId = user.id;
    return res.status(200).json({ workspaceId: existingWorkspaceId, incidentId: incident.id });
  } catch {
    return next();
  }
}

router.post(
  '/demo',
  requireSameOrigin,
  reuseExistingDemoGrant,
  rateLimit({ bucket: 'demo', max: 3, windowMs: 24 * 60 * 60 * 1000 }),
  async (req, res, next) => {
    const db = req.app.locals.db;
    let phase = 'count';
    let result;
    try {
      const active = seedDemoWorkspace.countActiveDemoWorkspaces(db);
      if (active >= 25) return res.status(503).json({ error: CAPACITY_ERROR });
      phase = 'seed';
      result = db.transaction(() => seedDemoWorkspace(db))();
    } catch (error) {
      if (phase === 'count') return res.status(503).json({ error: CAPACITY_ERROR });
      return next(error);
    }
    try {
      await regenerate(req);
      req.session.demoWorkspaceId = result.workspaceId;
      req.session.demoUserId = result.userId;
      return res.status(201).json({
        workspaceId: result.workspaceId,
        incidentId: result.incidentId,
      });
    } catch (error) {
      if (phase === 'count') return res.status(503).json({ error: CAPACITY_ERROR });
      return next(error);
    }
  },
);

module.exports = router;
