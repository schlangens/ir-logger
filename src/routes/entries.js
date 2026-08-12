const router = require('express').Router();
const { requireSession, resolveWorkspaceAccess, resolveActor } = require('../middleware/workspace-guard');
const entries = require('../services/entries');
const incidentService = require('../services/incidents');

function resolveEntryParent(req) {
  const db = req.app.locals.db;
  const row = entries.resolveEntryParent(db, req.params.id);
  if (!row) return { row: null, access: null };
  const access = resolveWorkspaceAccess(db, req, row.workspace_id);
  if (!access.ok && access.status === 404) access.error = 'Entry not found';
  return { row, access };
}
function resolveIncident(req) {
  const db = req.app.locals.db;
  const row = incidentService.resolveIncident(db, req.params.id);
  if (!row) return { row: null, access: { ok: false, status: 404, error: 'Incident not found' } };
  const access = resolveWorkspaceAccess(db, req, row.workspace_id);
  if (!access.ok && access.status === 404) access.error = 'Incident not found';
  return { row, access };
}
function bad(res, status, error) { return res.status(status).json({ error }); }

function parseUtc(value) {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
}

router.post('/incidents/:id/entries', (req, res, next) => {
  try {
    const { row, access } = resolveIncident(req);
    if (!row) return bad(res, 404, 'Incident not found');
    if (!access.ok) return bad(res, access.status, access.error);
    if (!['owner', 'analyst'].includes(access.role)) return bad(res, 403, 'Forbidden');
    const actor = resolveActor(req.app.locals.db, req, row.workspace_id);
    if (!actor) return bad(res, 401, 'Authentication required');
    const { kind, body_md: bodyMd, occurred_at: occurredAt = new Date().toISOString(), technique_ids: techniqueIds = [] } = req.body || {};
    const occurredIso = parseUtc(occurredAt);
    if (
      !['technical', 'timeline', 'note'].includes(kind) ||
      typeof bodyMd !== 'string' ||
      !bodyMd ||
      bodyMd.length > 50000 ||
      occurredIso === null ||
      !Array.isArray(techniqueIds) ||
      techniqueIds.some((id) => typeof id !== 'string')
    )
      return bad(res, 400, 'Invalid entry');
    const entry = entries.createEntry(req.app.locals.db, { incidentId: row.id, userId: actor.id, kind, occurredAt: occurredIso, bodyMd, techniqueIds });
    res.status(201).json({ entry });
  } catch (e) { if (e.status) return bad(res, e.status, e.message); next(e); }
});
router.get('/incidents/:id/entries', (req, res, next) => {
  try {
    const { row, access } = resolveIncident(req);
    if (!row) return bad(res, 404, 'Incident not found');
    if (!access.ok) return bad(res, access.status, access.error);
    const limit = Number(req.query.limit || 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (req.query.kind && !['technical', 'timeline', 'note'].includes(req.query.kind)))
      return bad(res, 400, 'Invalid entry filters');
    res.json({ entries: entries.listEntries(req.app.locals.db, row.id, { since: req.query.since, kind: req.query.kind, limit }) });
  } catch (e) { next(e); }
});
router.get('/entries/:id', requireSession, (req, res, next) => {
  try {
    const { row, access } = resolveEntryParent(req);
    if (!row) return bad(res, 404, 'Entry not found');
    if (!access.ok) return bad(res, access.status, access.error);
    res.json({ entry: entries.hydrate(req.app.locals.db, row.id) });
  } catch (e) { next(e); }
});
module.exports = router;
