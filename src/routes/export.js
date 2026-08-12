const router = require('express').Router();
const { requireWorkspace } = require('../middleware/workspace-guard');
const audit = require('../services/audit');
const { generatePdf } = require('../services/export-pdf');
const { generateMarkdown } = require('../services/export-markdown');

function incidentWorkspace(param = 'id') {
  return (req, res, next) => {
    try {
      const incident = req.app.locals.db
        .prepare('SELECT id, ref, workspace_id FROM incidents WHERE id=?')
        .get(req.params[param]);
      if (!incident) return res.status(404).json({ error: 'Incident not found' });
      req.incident = incident;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function sendExport(kind) {
  return async (req, res, next) => {
    try {
      const db = req.app.locals.db;
      const body = kind === 'pdf'
        ? await generatePdf(db, req.incident.id)
        : generateMarkdown(db, req.incident.id);
      if (!body) return res.status(404).json({ error: 'Incident not found' });
      audit.append(db, {
        workspaceId: req.workspace.id,
        actorUserId: req.user?.id || null,
        action: 'export',
        targetType: 'incident',
        targetId: req.incident.id,
        payload: { format: kind },
      });
      const filename = `${String(req.incident.ref).replace(/[^A-Za-z0-9._-]+/g, '-')}.${kind}`;
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      if (kind === 'pdf') return res.type('application/pdf').send(body);
      return res.set('Content-Type', 'text/markdown; charset=utf-8').send(body);
    } catch (error) {
      next(error);
    }
  };
}

// The guard's parameter is resolved from the incident, never accepted from the request.
function useIncidentWorkspace(req, res, next) {
  req.params.workspaceId = req.incident.workspace_id;
  return next();
}

router.get('/incidents/:id/export.pdf', incidentWorkspace(), useIncidentWorkspace, requireWorkspace({ param: 'workspaceId' }), sendExport('pdf'));
router.get('/incidents/:id/export.md', incidentWorkspace(), useIncidentWorkspace, requireWorkspace({ param: 'workspaceId' }), sendExport('md'));

module.exports = router;
