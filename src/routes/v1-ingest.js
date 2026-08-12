const router = require('express').Router();
const crypto = require('node:crypto');
const { rateLimit } = require('../middleware/rate-limit');
const { createIncident, findApiToken, findIncidentByRef, touchApiToken } = require('../services/incidents');
const { createEntry } = require('../services/entries');

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
const authLimiter = rateLimit({ bucket: 'v1-ingest-auth', max: 20, windowMs: 15 * 60 * 1000, countMode: 'refund-on-success' });
const tokenLimiter = rateLimit({ bucket: 'v1-ingest-token', max: 60, windowMs: 60 * 1000, keyFn: (req) => req.apiToken.id });

router.post('/v1/ingest', authLimiter, (req, res, next) => {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return res.status(401).json({ error: 'Invalid token' });
  try {
    const token = findApiToken(req.app.locals.db, hash(match[1]));
    if (!token) return res.status(401).json({ error: 'Invalid token' });
    req.rateLimit.refund();
    req.apiToken = token;
    next();
  } catch (e) { next(e); }
}, tokenLimiter, (req, res, next) => {
  const { incident_ref: incidentRef, kind, category, body, occurred_at: occurredAt = new Date().toISOString(), author_name: authorName } = req.body || {};
  if (typeof incidentRef !== 'string' || !incidentRef || !['technical', 'timeline'].includes(kind) || typeof body !== 'string' || !body || typeof occurredAt !== 'string' || (category !== undefined && typeof category !== 'string') || (authorName !== undefined && typeof authorName !== 'string'))
    return res.status(400).json({ error: 'Invalid ingest payload' });
  try {
    const db = req.app.locals.db;
    let incident = findIncidentByRef(db, req.apiToken.workspace_id, incidentRef);
    if (!incident) {
      incident = createIncident(db, { workspaceId: req.apiToken.workspace_id, userId: req.apiToken.user_id, ref: incidentRef, title: 'Synced from desktop', summary: '', severity: 'medium' });
    }
    let bodyMd = body;
    if (kind === 'technical' && category) bodyMd = `**Category:** ${category}\n\n${bodyMd}`;
    if (authorName) bodyMd += `\n\n_Originally logged by: ${authorName} (desktop sync)_`;
    const entry = createEntry(db, { incidentId: incident.id, userId: req.apiToken.user_id, kind, occurredAt, bodyMd });
    touchApiToken(db, req.apiToken.id, new Date().toISOString());
    res.status(201).json({ incidentId: incident.id, entryId: entry.id });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
module.exports = router;
