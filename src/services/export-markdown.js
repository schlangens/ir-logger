const { getReportData } = require('./export-pdf');
function listAuditEntries(db, workspaceId, limit, offset) {
  return db.prepare('SELECT * FROM audit_log WHERE workspace_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(workspaceId, limit, offset);
}
function markdownInline(runs) {
  return runs.map((run) => {
    if (run.type === 'break') return '  \n';
    if (run.type === 'bold') return `**${run.text}**`;
    if (run.type === 'italic') return `*${run.text}*`;
    if (run.type === 'code') return `\`${run.text}\``;
    if (run.type === 'link') return `[${run.text}](${run.href})`;
    return run.text || '';
  }).join('');
}
function generateMarkdown(db, incidentId) {
  const report = getReportData(db, incidentId); if (!report) return null;
  const { incident, entries, matrix, evidence } = report;
  const lines = [`# Incident ${incident.ref}: ${incident.title}`, '', `- **Summary:** ${incident.summary || '(none)'}`, `- **Severity:** ${incident.severity}`, `- **Status:** ${incident.status}`, `- **Opened:** ${incident.opened_at}`, `- **Closed:** ${incident.closed_at || '(open)'}`, '', '## Timeline entries'];
  for (const entry of entries) {
    lines.push(`### ${entry.occurred_at} — ${entry.author_name} — ${entry.kind}`, `Techniques: ${entry.technique_ids.join(', ') || '(none)'}`, '', entry.tokens.map((block) => {
      if (block.type === 'heading') return `${'#'.repeat(block.level)} ${markdownInline(block.inlines)}`;
      if (block.type === 'paragraph') return markdownInline(block.inlines);
      if (block.type === 'code') return `\`\`\`\n${block.text}\n\`\`\``;
      const marker = block.ordered ? '1.' : '-'; return block.items.map((item) => `${marker} ${markdownInline(item)}`).join('\n');
    }).join('\n\n'), '');
  }
  lines.push('## ATT&CK coverage matrix', '', '| Tactic | ID | Name | Count |', '| --- | --- | --- | ---: |');
  for (const row of matrix) lines.push(`| ${row.tactic} | ${row.id} | ${row.name} | ${row.count} |`);
  lines.push('', '## Evidence manifest', '', '| Filename | Size | SHA-256 | Uploader | Uploaded at |', '| --- | ---: | --- | --- | --- |');
  for (const item of evidence) lines.push(`| ${item.filename} | ${item.size} | ${item.sha256} | ${item.uploader} | ${item.uploaded_at} |`);
  return `${lines.join('\n')}\n`;
}
module.exports = { generateMarkdown, listAuditEntries };
