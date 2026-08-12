const router = require('express').Router();
const { requireUser, requireWorkspace, resolveWorkspaceAccess } = require('../middleware/workspace-guard');
const incidents = require('../services/incidents');
const hub = require('../sse/hub');

function resolveIncident(req) {
  const db = req.app.locals.db;
  const incident = incidents.resolveIncident(db, req.params.id);
  if (!incident) return { incident: null, access: { ok: false, status: 404, error: 'Incident not found' } };
  return { incident, access: resolveWorkspaceAccess(db, req, incident.workspace_id) };
}
function fail(res, error) { return res.status(error.status || 500).json({ error: error.message || 'Internal server error' }); }

router.post('/workspaces/:id/incidents', requireUser, requireWorkspace({ roles: ['owner', 'analyst'] }), (req, res, next) => {
  const { title, summary = '', severity } = req.body || {};
  if (typeof title !== 'string' || !title || title.length > 500 || typeof summary !== 'string' || !incidents.SEVERITIES.includes(severity))
    return res.status(400).json({ error: 'Valid title, summary, and severity are required' });
  try {
    const incident = incidents.createIncident(req.app.locals.db, { workspaceId: req.workspace.id, userId: req.user.id, title, summary, severity });
    res.status(201).json({ incident });
  } catch (e) { if (e.status) return fail(res, e); next(e); }
});
router.get('/workspaces/:id/incidents', requireWorkspace({}), (req, res, next) => {
  const { status, severity } = req.query;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  if ((status && !incidents.STATUSES.includes(status)) || (severity && !incidents.SEVERITIES.includes(severity)) || !Number.isInteger(limit) || !Number.isInteger(offset))
    return res.status(400).json({ error: 'Invalid filters or pagination' });
  try { res.json(incidents.listIncidents(req.app.locals.db, req.workspace.id, { status, severity, limit, offset })); } catch (e) { next(e); }
});
router.get('/incidents/:id/stream', (req, res, next) => {
  try {
    const { incident, access } = resolveIncident(req);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    hub.subscribe(incident.id, res);
  } catch (e) { next(e); }
});
router.get('/incidents/:id', (req, res, next) => {
  try {
    const { incident, access } = resolveIncident(req);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const result = incidents.readIncident(req.app.locals.db, incident.id);
    res.json({ incident: result });
  } catch (e) { next(e); }
});
router.patch('/incidents/:id', requireUser, (req, res, next) => {
  try {
    const { incident, access } = resolveIncident(req);
    if (!incident || !access.ok) return res.status(404).json({ error: 'Incident not found' });
    if (!['owner', 'analyst'].includes(access.role)) return res.status(403).json({ error: 'Forbidden' });
    const changes = req.body || {};
    for (const key of ['title', 'summary']) {
      if (Object.hasOwn(changes, key) && (typeof changes[key] !== 'string' || changes[key].length > 500))
        return res.status(400).json({ error: 'Invalid title or summary' });
    }
    const result = incidents.updateIncident(req.app.locals.db, { id: incident.id, workspaceId: incident.workspace_id, userId: req.user.id, role: access.role, changes });
    if (!result) return res.status(404).json({ error: 'Incident not found' });
    if (Object.keys(result.changes).length) hub.broadcast(incident.id, 'incident.updated', { id: incident.id, changes: result.changes });
    res.json({ incident: result.after });
  } catch (e) { if (e.status) return fail(res, e); next(e); }
});
module.exports = router;
