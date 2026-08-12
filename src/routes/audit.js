const router = require('express').Router();
const { requireWorkspace } = require('../middleware/workspace-guard');
const audit = require('../services/audit');
const { listAuditEntries } = require('../services/export-markdown');

function parseLimit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(String(value))) return { invalid: true };
  const parsed = Number.parseInt(value, 10);
  if (parsed <= 0) return 1;
  return Math.min(parsed, maximum);
}

function parseOffset(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

router.get(
  '/workspaces/:id/audit',
  requireWorkspace({ roles: ['owner'] }),
  (req, res, next) => {
    try {
      const limit = parseLimit(req.query.limit, 100, 500);
      if (limit && limit.invalid) return res.status(400).json({ error: 'Invalid limit' });
      const offset = parseOffset(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const entries = listAuditEntries(req.app.locals.db, req.workspace.id, limit, offset).map((entry) => ({
        ...entry,
        payload_json: JSON.parse(entry.payload_json),
      }));
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
      const { brokenAtId, ...result } = audit.verify(req.app.locals.db, req.workspace.id);
      if (brokenAtId !== undefined) result.broken_at_id = brokenAtId;
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
