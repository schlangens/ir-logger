const router = require('express').Router();
const { requireWorkspace } = require('../middleware/workspace-guard');
const { rateLimit } = require('../middleware/rate-limit');
const search = require('../services/search');

const searchRateLimit = rateLimit({
  bucket: 'search',
  max: 60,
  windowMs: 60 * 1000,
  keyFn: (req) => req.user?.id || req.session?.demoWorkspaceId || req.ip,
});

router.get('/workspaces/:id/search', searchRateLimit, requireWorkspace({}), (req, res, next) => {
  if (typeof req.query.q !== 'string' || !req.query.q.trim()) return res.status(400).json({ error: 'q is required' });
  try { res.json({ results: search.search(req.app.locals.db, req.workspace.id, req.query.q) }); } catch (e) { next(e); }
});
module.exports = router;
