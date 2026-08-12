const crypto = require("node:crypto");
const { nanoid } = require("nanoid"); // synchronous so audit.append() works inside better-sqlite3 transactions.
const GENESIS_PREV_HASH = "0".repeat(64);
function canonical(row) {
  return JSON.stringify({
    id: row.id,
    workspace_id: row.workspace_id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    at: row.at,
    payload_json: row.payload_json,
    prev_hash: row.prev_hash,
  });
}
function append(
  db,
  { workspaceId, actorUserId = null, action, targetType, targetId, payload },
) {
  const id = nanoid(16),
    at = new Date().toISOString(),
    payload_json = JSON.stringify(payload ?? {});
  const prev =
    db
      .prepare(
        "SELECT hash FROM audit_log WHERE workspace_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(workspaceId)?.hash || GENESIS_PREV_HASH;
  const row = {
    id,
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    at,
    payload_json,
    prev_hash: prev,
  };
  const hash = crypto
    .createHash("sha256")
    .update(prev + canonical(row))
    .digest("hex");
  db.prepare(
    "INSERT INTO audit_log (id,workspace_id,actor_user_id,action,target_type,target_id,at,payload_json,prev_hash,hash) VALUES (@id,@workspace_id,@actor_user_id,@action,@target_type,@target_id,@at,@payload_json,@prev_hash,@hash)",
  ).run({ ...row, hash });
  return { ...row, hash };
}
function verify(db, workspaceId) {
  let previous = GENESIS_PREV_HASH,
    checked = 0;
  for (const row of db
    .prepare("SELECT * FROM audit_log WHERE workspace_id=? ORDER BY rowid")
    .all(workspaceId)) {
    checked++;
    if (
      row.prev_hash !== previous ||
      crypto
        .createHash("sha256")
        .update(row.prev_hash + canonical(row))
        .digest("hex") !== row.hash
    )
      return { valid: false, checked, brokenAtId: row.id };
    previous = row.hash;
  }
  return { valid: true, checked };
}
module.exports = { append, verify, GENESIS_PREV_HASH };
