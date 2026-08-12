const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
let defaultDb;
function openDatabase(dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/ir-logger.db')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
function runMigrations(db) {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  const applied = new Set(hasTable ? db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version) : []);
  for (const file of files) {
    const version = Number(file.match(/^\d+/)[0]);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version); })();
  }
  return db;
}
function getDb() { if (!defaultDb) { defaultDb = openDatabase(); runMigrations(defaultDb); } return defaultDb; }
module.exports = { openDatabase, runMigrations, getDb };
