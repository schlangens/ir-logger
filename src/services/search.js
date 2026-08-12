function search(db, workspaceId, q) {
  const match = `"${q.replaceAll('"', '""')}"`;
  return db.prepare(`SELECT i.id AS incidentId, i.ref AS incidentRef, i.title AS incidentTitle,
    e.id AS entryId, snippet(entries_fts, 0, '<b>', '</b>', '…', 32) AS snippet,
    bm25(entries_fts) AS rank
    FROM entries_fts JOIN entries e ON e.rowid=entries_fts.rowid
    JOIN incidents i ON i.id=e.incident_id
    WHERE i.workspace_id=? AND entries_fts MATCH ? ORDER BY rank LIMIT 50`).all(workspaceId, match);
}
module.exports = { search };
