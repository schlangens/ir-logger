const TACTIC_ORDER = [
  'Reconnaissance',
  'Resource Development',
  'Initial Access',
  'Execution',
  'Persistence',
  'Privilege Escalation',
  'Defense Evasion',
  'Credential Access',
  'Discovery',
  'Lateral Movement',
  'Collection',
  'Command and Control',
  'Exfiltration',
  'Impact',
];

function getIncidentWorkspace(db, incidentId) {
  return db
    .prepare('SELECT workspace_id FROM incidents WHERE id = ?')
    .get(incidentId);
}

function getMatrix(db, incidentId) {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.tactic, t.url,
              COUNT(DISTINCT e.id) AS count
       FROM techniques t
       LEFT JOIN entry_techniques et ON et.technique_id = t.id
       LEFT JOIN entries e
         ON e.id = et.entry_id
        AND e.incident_id = ?
       GROUP BY t.id, t.name, t.tactic, t.url
       ORDER BY t.tactic, t.id`,
    )
    .all(incidentId);
  const byTactic = new Map(TACTIC_ORDER.map((tactic) => [tactic, []]));
  for (const row of rows) {
    byTactic.get(row.tactic)?.push({
      id: row.id,
      name: row.name,
      url: row.url,
      count: row.count,
    });
  }
  return {
    tactics: TACTIC_ORDER.map((tactic) => ({
      tactic,
      techniques: byTactic.get(tactic),
    })),
  };
}

module.exports = { TACTIC_ORDER, getIncidentWorkspace, getMatrix };
