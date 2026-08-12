const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { renderMarkdown } = require('./markdown-render');
function getReportData(db, incidentId) {
  const incident = db.prepare(`SELECT i.*, w.name AS workspace_name FROM incidents i JOIN workspaces w ON w.id=i.workspace_id WHERE i.id=?`).get(incidentId);
  if (!incident) return null;
  const entries = db.prepare(`SELECT e.*, u.name AS author_name, GROUP_CONCAT(et.technique_id) AS technique_ids FROM entries e JOIN users u ON u.id=e.author_user_id LEFT JOIN entry_techniques et ON et.entry_id=e.id WHERE e.incident_id=? GROUP BY e.id ORDER BY e.occurred_at, e.created_at, e.rowid`).all(incidentId).map((entry) => ({ ...entry, technique_ids: entry.technique_ids ? entry.technique_ids.split(',') : [], tokens: renderMarkdown(entry.body_md) }));
  const matrix = db.prepare(`SELECT t.tactic, t.id, t.name, COUNT(DISTINCT CASE WHEN e.incident_id=? THEN et.entry_id END) AS count FROM techniques t LEFT JOIN entry_techniques et ON et.technique_id=t.id LEFT JOIN entries e ON e.id=et.entry_id GROUP BY t.id ORDER BY t.tactic, t.id`).all(incidentId);
  const evidence = db.prepare(`SELECT e.filename, e.size, e.sha256, e.uploaded_at, u.name AS uploader FROM evidence e JOIN users u ON u.id=e.uploaded_by WHERE e.incident_id=? ORDER BY e.uploaded_at, e.rowid`).all(incidentId);
  return { incident, entries, matrix, evidence };
}
function inlineText(runs) { return runs.map((run) => (run.type === 'break' ? '\n' : run.text || '')).join(''); }
function reportLines(report) {
  const { incident, entries, matrix, evidence } = report;
  const lines = [`Incident ${incident.ref}: ${incident.title}`, `Summary: ${incident.summary || '(none)'}`, `Severity: ${incident.severity}    Status: ${incident.status}`, `Opened: ${incident.opened_at}    Closed: ${incident.closed_at || '(open)'}`, '', 'Timeline entries'];
  for (const entry of entries) { lines.push(`${entry.occurred_at} | ${entry.author_name} | ${entry.kind} | Techniques: ${entry.technique_ids.join(', ') || '(none)'}`); lines.push(...inlineText(entry.tokens).split('\n'), ''); }
  lines.push('ATT&CK coverage matrix'); for (const row of matrix) lines.push(`${row.tactic} | ${row.id} | ${row.name} | ${row.count}`);
  lines.push('', 'Evidence manifest'); for (const item of evidence) lines.push(`${item.filename} | ${item.size} bytes | ${item.sha256} | ${item.uploader} | ${item.uploaded_at}`);
  return lines;
}
async function generatePdf(db, incidentId) {
  const report = getReportData(db, incidentId); if (!report) return null;
  const document = await PDFDocument.create(), regular = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  const size = 9, lineHeight = 13, margin = 42; let page; let y;
  const newPage = () => { page = document.addPage(); y = page.getHeight() - margin; };
  const draw = (text, isBold = false) => {
    const font = isBold ? bold : regular, maxWidth = page.getWidth() - margin * 2; let line = '';
    const drawLine = (value) => { if (y < margin) newPage(); page.drawText(value, { x: margin, y, size, font, color: rgb(0, 0, 0) }); y -= lineHeight; };
    for (const word of String(text).split(/(\s+)/)) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (line) { drawLine(line); line = ''; }
        let rest = word;
        while (rest && font.widthOfTextAtSize(rest, size) > maxWidth) {
          let cut = rest.length;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
          drawLine(rest.slice(0, cut)); rest = rest.slice(cut);
        }
        line = rest;
      } else if (line && font.widthOfTextAtSize(line + word, size) > maxWidth) {
        drawLine(line); line = word.trimStart();
      } else line += word;
    }
    drawLine(line);
  };
  newPage(); for (const line of reportLines(report)) draw(line, ['Timeline entries', 'ATT&CK coverage matrix', 'Evidence manifest'].includes(line));
  return Buffer.from(await document.save());
}
module.exports = { generatePdf, getReportData, reportLines };
