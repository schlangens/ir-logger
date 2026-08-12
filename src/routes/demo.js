const router = require('express').Router();
const { rateLimit } = require('../middleware/rate-limit');
const seedDemoWorkspace = require('../services/demo-seed');

const CAPACITY_ERROR = 'Demo capacity unavailable';

router.post(
  '/demo',
  rateLimit({ bucket: 'demo', max: 3, windowMs: 24 * 60 * 60 * 1000 }),
  (req, res, next) => {
    const db = req.app.locals.db;
    let phase = 'count';
    try {
      const result = db.transaction(() => {
        const active = seedDemoWorkspace.countActiveDemoWorkspaces(db);
        if (active >= 25) return null;
        phase = 'seed';
        return seedDemoWorkspace(db);
      })();
      if (!result) return res.status(503).json({ error: CAPACITY_ERROR });
      req.session.demoWorkspaceId = result.workspaceId;
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
