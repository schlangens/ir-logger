const router = require('express').Router();
const { requireWorkspace } = require('../middleware/workspace-guard');
const search = require('../services/search');
router.get('/workspaces/:id/search', requireWorkspace({}), (req, res, next) => {
  if (typeof req.query.q !== 'string' || !req.query.q.trim()) return res.status(400).json({ error: 'q is required' });
  try { res.json({ results: search.search(req.app.locals.db, req.workspace.id, req.query.q) }); } catch (e) { next(e); }
});
module.exports = router;
