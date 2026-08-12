const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { nanoid } = require('nanoid');
const { evidenceDir } = require('../uploads/storage');
const audit = require('./audit');

const TECHNIQUES = ['T1566.001', 'T1204.002', 'T1003.001', 'T1021.001'];
const WORKSPACE_NAME = 'Contoso Finance — Demo Sandbox';

function seedDemoWorkspace(db, { expiresAt } = {}) {
  const workspaceId = nanoid(16);
  const userId = nanoid(16);
  const incidentId = nanoid(16);
  const evidenceId = nanoid(16);
  const effectiveExpiresAt =
    expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const now = Date.now();

  const storedPath = path.join(evidenceDir, `${nanoid(24)}.bin`);
  const header = Buffer.from(
    [
      'Received: from mail.contoso-finance.example (203.0.113.44)',
      '        by mx.contoso-finance.example with ESMTPS id demo-7f3a',
      '        for <finance@example.invalid>; Tue, 14 May 2024 14:01:17 +0000',
      'From: Accounts Payable <ap@contoso-finance.example>',
      'To: Finance Team <finance@example.invalid>',
      'Subject: Updated Q2 payment schedule',
      'Date: Tue, 14 May 2024 14:01:12 +0000',
      'Message-ID: <20240514140112.demo@contoso-finance.example>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="demo-boundary"',
      '',
      '--demo-boundary',
      'Content-Type: application/vnd.ms-excel.sheet.macroEnabled.12',
      'Content-Disposition: attachment; filename="Q2-payment-schedule.xlsm"',
      '',
      '[fabricated demo attachment omitted]',
      '--demo-boundary--',
      '',
    ].join('\r\n'),
    'utf8',
  );
  const sha256 = crypto.createHash('sha256').update(header).digest('hex');

  let fileWritten = false;
  try {
    fs.writeFileSync(storedPath, header);
    fileWritten = true;

    const result = db.transaction(() => {
      db.prepare(
        'INSERT INTO workspaces (id, name, is_demo, expires_at) VALUES (?, ?, 1, ?)',
      ).run(workspaceId, WORKSPACE_NAME, effectiveExpiresAt);
      db.prepare(
        'INSERT INTO users (id, email, name, is_demo) VALUES (?, ?, ?, 1)',
      ).run(userId, `demo-${workspaceId}@demo.invalid`, 'Demo visitor');
      audit.append(db, {
        workspaceId,
        actorUserId: userId,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: workspaceId,
        payload: { demo: true },
      });

      db.prepare(
        'INSERT INTO incidents (id, workspace_id, ref, title, severity, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        incidentId,
        workspaceId,
        'IR-DEMO-0001',
        'Suspicious login → lateral movement — Contoso Finance',
        'high',
        'contained',
        userId,
      );

      const techniqueIds = new Map(
        db
          .prepare(`SELECT id FROM techniques WHERE id IN (${TECHNIQUES.map(() => '?').join(',')})`)
          .all(...TECHNIQUES)
          .map((row) => [row.id, row.id]),
      );
      for (const techniqueId of TECHNIQUES) {
        if (!techniqueIds.has(techniqueId))
          throw new Error(`Required demo technique is missing: ${techniqueId}`);
      }

      const entries = [
        ['technical', 'Spearphishing email with malicious .xlsm attachment delivered to a Finance mailbox', 'T1566.001'],
        ['technical', 'User opened attachment, macro executed', 'T1204.002'],
        ['timeline', 'Endpoint alert fired, IR triggered', null],
        ['technical', 'LSASS memory access observed on the patient-zero host', 'T1003.001'],
        ['technical', 'RDP session from patient-zero to a finance file server using harvested credentials', 'T1021.001'],
        ['note', 'Finance file server isolated from the network at 14:32 UTC', null],
      ];
      const entryIds = [];
      const insertEntry = db.prepare(
        'INSERT INTO entries (id, incident_id, kind, occurred_at, body_md, author_user_id) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const insertTechnique = db.prepare(
        'INSERT INTO entry_techniques (entry_id, technique_id) VALUES (?, ?)',
      );
      for (let index = 0; index < entries.length; index++) {
        const [kind, body, technique] = entries[index];
        const entryId = nanoid(16);
        entryIds.push(entryId);
        insertEntry.run(
          entryId,
          incidentId,
          kind,
          new Date(now + index * 60 * 1000).toISOString(),
          body,
          userId,
        );
        if (technique) insertTechnique.run(entryId, techniqueIds.get(technique));
      }

      db.prepare(
        'INSERT INTO evidence (id, incident_id, entry_id, filename, mime, size, sha256, stored_path, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        evidenceId,
        incidentId,
        entryIds[0],
        'phishing-email-headers.txt',
        'text/plain',
        header.length,
        sha256,
        storedPath,
        userId,
      );
      db.prepare(
        'INSERT INTO custody_events (id, evidence_id, action, actor_user_id, note) VALUES (?, ?, ?, ?, ?)',
      ).run(nanoid(16), evidenceId, 'uploaded', userId, 'Seeded demo evidence');
      audit.append(db, {
        workspaceId,
        actorUserId: userId,
        action: 'evidence.uploaded',
        targetType: 'evidence',
        targetId: evidenceId,
        payload: { filename: 'phishing-email-headers.txt', size: header.length },
      });

      return { workspaceId, incidentId, userId, evidenceId, storedPath, sha256 };
    })();
    return result;
  } catch (error) {
    if (fileWritten) {
      try {
        fs.unlinkSync(storedPath);
      } catch {}
    }
    throw error;
  }
}

seedDemoWorkspace.countActiveDemoWorkspaces = (db, now = new Date().toISOString()) =>
  db
    .prepare(
      'SELECT COUNT(*) AS n FROM workspaces WHERE is_demo=1 AND expires_at > ?',
    )
    .get(now).n;

module.exports = seedDemoWorkspace;
