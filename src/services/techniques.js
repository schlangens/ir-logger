function escapeLike(value) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function list(db, { tactic, q } = {}) {
  const clauses = [];
  const params = {};
  if (tactic !== undefined) {
    clauses.push('tactic = @tactic');
    params.tactic = tactic;
  }
  if (q !== undefined) {
    const pattern = `%${escapeLike(q.toLowerCase())}%`;
    clauses.push("(lower(id) LIKE @q ESCAPE '\\' OR lower(name) LIKE @q ESCAPE '\\')");
    params.q = pattern;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT id, name, tactic, url
       FROM techniques
       ${where}
       ORDER BY tactic, id`,
    )
    .all(params);
}

module.exports = { list };
