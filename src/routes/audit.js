const router = require('express').Router();
const { requireWorkspace } = require('../middleware/workspace-guard');
const audit = require('../services/audit');
const { listAuditEntries } = require('../services/export-markdown');

function pagination(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

router.get(
  '/workspaces/:id/audit',
  requireWorkspace({ roles: ['owner'] }),
  (req, res, next) => {
    try {
      const limit = pagination(req.query.limit, 100, 500);
      const offset = pagination(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const entries = listAuditEntries(req.app.locals.db, req.workspace.id, limit, offset);
      return res.json({ entries });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  '/workspaces/:id/audit/verify',
  requireWorkspace({ roles: ['owner'] }),
  (req, res, next) => {
    try {
      return res.json(audit.verify(req.app.locals.db, req.workspace.id));
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
