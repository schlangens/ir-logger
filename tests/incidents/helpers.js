process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'round2a-test-secret';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { openDatabase, runMigrations } = require('../../src/db');
const { createApp } = require('../../src/server');

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-round2a-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  runMigrations(db);
  const app = createApp(db, { startSweeper: false });
  return { db, app, close: () => { app.locals.sessionStore.stopCleanup(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
async function register(app, email, name) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ email, name, password: 'round2a-password' });
  if (response.status !== 201) throw new Error(`registration failed: ${response.status}`);
  return agent;
}
module.exports = { makeApp, register };
