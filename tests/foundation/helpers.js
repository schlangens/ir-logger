process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'foundation-test-secret';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, runMigrations } = require('../../src/db');
function db() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-foundation-'));
  const d = openDatabase(path.join(dir, 'test.db'));
  runMigrations(d);
  return { db: d, dir };
}
module.exports = { db };
