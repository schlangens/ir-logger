const { nanoid } = require('nanoid');

function createId() {
  return nanoid(16);
}

function metadata(row) {
  return {
    id: row.id,
    incident_id: row.incident_id,
    entry_id: row.entry_id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
  };
}

function getIncident(db, incidentId) {
  return db.prepare('SELECT id,workspace_id FROM incidents WHERE id=?').get(incidentId);
}

function getById(db, evidenceId) {
  return db.prepare('SELECT * FROM evidence WHERE id=?').get(evidenceId);
}

function getWithWorkspace(db, evidenceId) {
  return db
    .prepare(
      `SELECT e.*, i.workspace_id
       FROM evidence e
       JOIN incidents i ON i.id=e.incident_id
       WHERE e.id=?`,
    )
    .get(evidenceId);
}

function listByIncident(db, incidentId) {
  return db
    .prepare(
      `SELECT id,incident_id,entry_id,filename,mime,size,sha256,uploaded_by,uploaded_at
       FROM evidence WHERE incident_id=? ORDER BY uploaded_at ASC, rowid ASC`,
    )
    .all(incidentId)
    .map(metadata);
}

function usage(db, workspaceId) {
  return db
    .prepare(
      `SELECT COUNT(e.id) AS count, COALESCE(SUM(e.size), 0) AS bytes
       FROM evidence e JOIN incidents i ON i.id=e.incident_id
       WHERE i.workspace_id=?`,
    )
    .get(workspaceId);
}

function entryBelongsToIncident(db, entryId, incidentId) {
  return db.prepare('SELECT id FROM entries WHERE id=? AND incident_id=?').get(entryId, incidentId);
}

function insert(
  db,
  { id = createId(), incidentId, entryId, filename, mime, size, sha256, storedPath, uploadedBy },
) {
  db.prepare(
    `INSERT INTO evidence
      (id,incident_id,entry_id,filename,mime,size,sha256,stored_path,uploaded_by)
      VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    incidentId,
    entryId || null,
    filename,
    mime || 'application/octet-stream',
    size,
    sha256,
    storedPath,
    uploadedBy,
  );
  return id;
}

module.exports = {
  metadata,
  createId,
  getIncident,
  getById,
  getWithWorkspace,
  listByIncident,
  usage,
  entryBelongsToIncident,
  insert,
};
