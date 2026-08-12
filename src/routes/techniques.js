const express = require('express');
const { requireSession, resolveWorkspaceAccess } = require('../middleware/workspace-guard');
const techniques = require('../services/techniques');
const matrix = require('../services/matrix');

const router = express.Router();

router.get('/techniques', requireSession, (req, res) => {
  const { tactic, q } = req.query;
  if (
    (tactic !== undefined && typeof tactic !== 'string') ||
    (q !== undefined && typeof q !== 'string')
  )
    return res.status(400).json({ error: 'Query parameters must be strings' });
  const rows = techniques.list(req.app.locals.db, { tactic, q });
  return res.json({ techniques: rows });
});

router.get('/incidents/:id/matrix', requireSession, (req, res) => {
  let incident;
  try {
    incident = matrix.getIncidentWorkspace(req.app.locals.db, req.params.id);
  } catch (error) {
    return res.status(403).json({ error: 'Unable to resolve workspace access' });
  }
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const access = resolveWorkspaceAccess(req.app.locals.db, req, incident.workspace_id);
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const result = matrix.getMatrix(req.app.locals.db, req.params.id);
  return res.json(result);
});

module.exports = router;
