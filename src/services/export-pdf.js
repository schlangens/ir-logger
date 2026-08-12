const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { renderMarkdown } = require('./markdown-render');

function getReportData(db, incidentId) {
  const incident = db
    .prepare(
      `SELECT i.*, w.name AS workspace_name
       FROM incidents i
       JOIN workspaces w ON w.id=i.workspace_id
       WHERE i.id=?`,
    )
    .get(incidentId);
  if (!incident) return null;
  const entries = db
    .prepare(
      `SELECT e.*, u.name AS author_name,
        GROUP_CONCAT(et.technique_id) AS technique_ids
       FROM entries e
       JOIN users u ON u.id=e.author_user_id
       LEFT JOIN entry_techniques et ON et.entry_id=e.id
       WHERE e.incident_id=?
       GROUP BY e.id
       ORDER BY e.occurred_at, e.created_at, e.rowid`,
    )
    .all(incidentId)
    .map((entry) => ({
      ...entry,
      technique_ids: entry.technique_ids ? entry.technique_ids.split(',') : [],
      tokens: renderMarkdown(entry.body_md),
    }));
  const matrix = db
    .prepare(
      `SELECT t.tactic, t.id, t.name,
        COUNT(DISTINCT CASE WHEN e.incident_id=? THEN et.entry_id END) AS count
       FROM techniques t
       LEFT JOIN entry_techniques et ON et.technique_id=t.id
       LEFT JOIN entries e ON e.id=et.entry_id
       GROUP BY t.id
       ORDER BY t.tactic, t.id`,
    )
    .all(incidentId);
  const evidence = db
    .prepare(
      `SELECT e.filename, e.size, e.sha256, e.uploaded_at,
        u.name AS uploader
       FROM evidence e
       JOIN users u ON u.id=e.uploaded_by
       WHERE e.incident_id=?
       ORDER BY e.uploaded_at, e.rowid`,
    )
    .all(incidentId);
  return { incident, entries, matrix, evidence };
}

async function generatePdf(db, incidentId) {
  const report = getReportData(db, incidentId);
  if (!report) return null;
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const size = 9;
  const lineHeight = 13;
  const margin = 42;
  let page;
  let y;

  const newPage = () => {
    page = document.addPage();
    y = page.getHeight() - margin;
  };
  const drawLine = (text, font, textSize, indent = 0) => {
    if (y < margin) newPage();
    page.drawText(text, {
      x: margin + indent,
      y,
      size: textSize,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  };
  const drawWrapped = (text, font = regular, textSize = size, indent = 0) => {
    const maxWidth = page.getWidth() - margin * 2 - indent;
    let line = '';
    for (const word of String(text).split(/(\s+)/)) {
      if (font.widthOfTextAtSize(word, textSize) > maxWidth) {
        if (line) {
          drawLine(line, font, textSize, indent);
          line = '';
        }
        let rest = word;
        while (rest && font.widthOfTextAtSize(rest, textSize) > maxWidth) {
          let cut = rest.length;
          while (
            cut > 1 &&
            font.widthOfTextAtSize(rest.slice(0, cut), textSize) > maxWidth
          ) {
            cut--;
          }
          drawLine(rest.slice(0, cut), font, textSize, indent);
          rest = rest.slice(cut);
        }
        line = rest;
      } else if (line && font.widthOfTextAtSize(line + word, textSize) > maxWidth) {
        drawLine(line, font, textSize, indent);
        line = word.trimStart();
      } else {
        line += word;
      }
    }
    drawLine(line, font, textSize, indent);
  };
  const drawRuns = (runs, textSize = size, indent = 0, forceFont = null) => {
    const maxWidth = page.getWidth() - margin * 2 - indent;
    let x = margin + indent;
    const flush = () => {
      y -= lineHeight;
      x = margin + indent;
    };
    for (const run of runs) {
      if (run.type === 'break') {
        if (x !== margin + indent) flush();
        continue;
      }
      const text = run.type === 'link'
        ? `${run.text} (${run.href})`
        : run.text || '';
      const safeText = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
      const font = forceFont || (run.type === 'bold' ? bold : regular);
      for (const word of safeText.split(/(\s+)/)) {
        const width = font.widthOfTextAtSize(word, textSize);
        if (width > maxWidth) {
          if (x !== margin + indent) flush();
          let rest = word;
          while (rest && font.widthOfTextAtSize(rest, textSize) > maxWidth) {
            let cut = rest.length;
            while (
              cut > 1 &&
              font.widthOfTextAtSize(rest.slice(0, cut), textSize) > maxWidth
            ) {
              cut--;
            }
            if (y < margin) newPage();
            page.drawText(rest.slice(0, cut), {
              x,
              y,
              size: textSize,
              font,
              color: rgb(0, 0, 0),
            });
            rest = rest.slice(cut);
            flush();
          }
          if (rest) {
            if (y < margin) newPage();
            page.drawText(rest, {
              x,
              y,
              size: textSize,
              font,
              color: rgb(0, 0, 0),
            });
            x += font.widthOfTextAtSize(rest, textSize);
          }
          continue;
        }
        if (x !== margin + indent && x - margin - indent + width > maxWidth) {
          flush();
        }
        if (y < margin) newPage();
        page.drawText(word, {
          x,
          y,
          size: textSize,
          font,
          color: rgb(0, 0, 0),
        });
        x += width;
      }
    }
    if (x !== margin + indent) y -= lineHeight;
  };
  const drawBlocks = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'heading') {
        drawRuns(block.inlines, block.level === 2 ? 13 : 11, 0, bold);
      } else if (block.type === 'paragraph') {
        drawRuns(block.inlines);
      } else if (block.type === 'code') {
        for (const line of block.text.split('\n')) {
          drawWrapped(`    ${line}`, regular, size, 12);
        }
      } else {
        block.items.forEach((item, index) => {
          const marker = block.ordered ? `${index + 1}. ` : '• ';
          drawRuns([{ type: 'text', text: marker }, ...item], size, 12);
        });
      }
      y -= 4;
    }
  };

  newPage();
  drawWrapped(`Incident ${report.incident.ref}: ${report.incident.title}`, bold, 14);
  drawWrapped(`Summary: ${report.incident.summary || '(none)'}`);
  drawWrapped(`Severity: ${report.incident.severity}    Status: ${report.incident.status}`);
  drawWrapped(
    `Opened: ${report.incident.opened_at}    Closed: ${report.incident.closed_at || '(open)'}`,
  );
  y -= 6;
  drawWrapped('Timeline entries', bold, 13);
  for (const entry of report.entries) {
    drawWrapped(
      `${entry.occurred_at} | ${entry.author_name} | ${entry.kind} | Techniques: ${
        entry.technique_ids.join(', ') || '(none)'
      }`,
      bold,
    );
    drawBlocks(entry.tokens);
  }
  drawWrapped('ATT&CK coverage matrix', bold, 13);
  for (const row of report.matrix) {
    drawWrapped(`${row.tactic} | ${row.id} | ${row.name} | ${row.count}`);
  }
  drawWrapped('Evidence manifest', bold, 13);
  for (const item of report.evidence) {
    drawWrapped(
      `${item.filename} | ${item.size} bytes | ${item.sha256} | ${item.uploader} | ${item.uploaded_at}`,
    );
  }
  return Buffer.from(await document.save());
}

module.exports = { generatePdf, getReportData };
