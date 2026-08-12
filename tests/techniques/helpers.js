const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const { openDatabase, runMigrations } = require('../../src/db');
const { createApp } = require('../../src/server');

function makeContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-techniques-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  runMigrations(db);
  const app = createApp(db, { startSweeper: false });
  return { db, app };
}

async function registerWorkspace(app, name = 'Workspace') {
  const agent = request.agent(app);
  const registered = await agent.post('/api/auth/register').send({
    email: `${crypto.randomUUID()}@example.test`,
    name: 'Analyst',
    password: 'long-password',
  });
  if (registered.status !== 201) throw new Error(`registration failed: ${registered.status}`);
  const workspace = await agent.post('/api/workspaces').send({ name });
  if (workspace.status !== 201) throw new Error(`workspace failed: ${workspace.status}`);
  return {
    agent,
    cookie: registered.headers['set-cookie'][0],
    userId: registered.body.user.id,
    workspaceId: workspace.body.workspace.id,
  };
}

function closeContext({ app, db }) {
  app.locals.sessionStore.stopCleanup();
  db.close();
}

function incident(db, { id, workspaceId, userId, ref = id }) {
  db.prepare(
    `INSERT INTO incidents (id, workspace_id, ref, title, severity, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, ref, 'Test incident', 'medium', userId);
}

function entry(db, { id, incidentId, userId, body = 'Test entry' }) {
  db.prepare(
    `INSERT INTO entries (id, incident_id, kind, occurred_at, body_md, author_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, incidentId, 'technical', new Date().toISOString(), body, userId);
}

function tag(db, entryId, techniqueId) {
  db.prepare('INSERT INTO entry_techniques (entry_id, technique_id) VALUES (?, ?)').run(
    entryId,
    techniqueId,
  );
}

function grantDemoSession(db, cookie, workspaceId) {
  const sid = decodeURIComponent(cookie.match(/connect\.sid=s%3A([^\.]+)\./)[1]);
  const row = db.prepare('SELECT session_json FROM sessions WHERE sid = ?').get(sid);
  const session = JSON.parse(row.session_json);
  session.demoWorkspaceId = workspaceId;
  db.prepare('UPDATE sessions SET session_json = ? WHERE sid = ?').run(JSON.stringify(session), sid);
}

module.exports = {
  makeContext,
  registerWorkspace,
  closeContext,
  incident,
  entry,
  tag,
  grantDemoSession,
};
