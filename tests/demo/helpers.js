process.env.SESSION_SECRET = `demo-test-secret-${process.pid}`;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-demo-run-'));
process.env.EVIDENCE_DIR = path.join(runDir, 'evidence');
fs.mkdirSync(process.env.EVIDENCE_DIR, { recursive: true });
const { openDatabase, runMigrations } = require('../../src/db');

function db() {
  const dir = fs.mkdtempSync(path.join(runDir, 'db-'));
  const database = openDatabase(path.join(dir, 'test.db'));
  runMigrations(database);
  return { db: database, dir, evidenceDir: process.env.EVIDENCE_DIR };
}

module.exports = { db };
