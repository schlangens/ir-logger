const HL_START = '{{{FTS5-HL-OPEN}}}';
const HL_END = '{{{FTS5-HL-CLOSE}}}';
const HL_START_RE = new RegExp(escapeRegExp(HL_START), 'g');
const HL_END_RE = new RegExp(escapeRegExp(HL_END), 'g');

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitize(q) {
  // Strip NUL and the rest of the C0 control range, plus DEL, then cap length.
  return q.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
}

function htmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function search(db, workspaceId, q) {
  const cleaned = sanitize(q);
  if (!cleaned.trim()) return [];
  const match = `"${cleaned.replace(/"/g, '""')}"`;
  const rows = db.prepare(`SELECT i.id AS incidentId, i.ref AS incidentRef, i.title AS incidentTitle,
    e.id AS entryId, snippet(entries_fts, 0, ?, ?, '…', 32) AS snippet,
    bm25(entries_fts) AS rank
    FROM entries_fts JOIN entries e ON e.rowid=entries_fts.rowid
    JOIN incidents i ON i.id=e.incident_id
    WHERE i.workspace_id=? AND entries_fts MATCH ? ORDER BY rank LIMIT 50`).all(HL_START, HL_END, workspaceId, match);
  return rows.map((r) => ({
    ...r,
    snippet: htmlEscape(r.snippet).replace(HL_START_RE, '<b>').replace(HL_END_RE, '</b>'),
  }));
}

module.exports = { search };
