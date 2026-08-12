const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const crypto = require("node:crypto");
const { db: makeDb } = require("./helpers");
const { createApp } = require("../../src/server");

function close(app, db) {
  app.locals.sessionStore.stopCleanup();
  db.close();
}
async function register(app, email, name = "User") {
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/register")
    .send({ email, name, password: "long-password" });
  assert.equal(response.status, 201);
  return agent;
}

test("workspace create/list/get enforce membership and response shape", async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, "owner@example.test", "Owner");
  const other = await register(app, "other@example.test", "Other");
  const created = await owner
    .post("/api/workspaces")
    .send({ name: "Workspace" });
  assert.equal(created.status, 201);
  const workspaceId = created.body.workspace.id;
  const list = await owner.get("/api/workspaces");
  assert.deepEqual(
    list.body.workspaces.map((workspace) => workspace.id),
    [workspaceId],
  );
  const memberView = await owner.get(`/api/workspaces/${workspaceId}`);
  assert.equal(memberView.status, 200);
  assert.equal(memberView.body.workspace.id, workspaceId);
  assert.ok(Array.isArray(memberView.body.members));
  assert.equal(memberView.body.workspace.members, undefined);
  const denied = await other.get(`/api/workspaces/${workspaceId}`);
  assert.equal(denied.status, 404);
});

test("owner invites and invited user accepts by raw token hash", async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, "owner-invite@example.test", "Owner");
  const invited = await register(app, "invited@example.test", "Invited");
  const workspace = await owner
    .post("/api/workspaces")
    .send({ name: "Invites" });
  const id = workspace.body.workspace.id;
  const invite = await owner
    .post(`/api/workspaces/${id}/invite`)
    .send({ email: "invited@example.test", role: "analyst" });
  assert.equal(invite.status, 201);
  const rawToken = invite.body.inviteUrl.split("/").pop();
  const stored = db
    .prepare("SELECT token_hash FROM invites WHERE workspace_id = ?")
    .get(id);
  assert.equal(
    stored.token_hash,
    crypto.createHash("sha256").update(rawToken).digest("hex"),
  );
  assert.notEqual(stored.token_hash, rawToken);
  const accepted = await invited.post(`/api/invites/${rawToken}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.workspace.role, "analyst");
  assert.equal(
    (await invited.post(`/api/invites/${rawToken}/accept`)).status,
    404,
  );
  const expired = "expired-token";
  db.prepare(
    "INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "expired",
    id,
    "invited@example.test",
    "viewer",
    crypto.createHash("sha256").update(expired).digest("hex"),
    db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("owner-invite@example.test").id,
    new Date(Date.now() - 1000).toISOString(),
  );
  assert.equal(
    (await invited.post(`/api/invites/${expired}/accept`)).status,
    404,
  );
});

test("non-owners cannot invite or manage tokens, and token lifecycle hides secrets", async (t) => {
  const { db } = makeDb();
  const app = createApp(db, { startSweeper: false });
  t.after(() => close(app, db));
  const owner = await register(app, "token-owner@example.test", "Owner");
  const analyst = await register(app, "token-analyst@example.test", "Analyst");
  const id = (await owner.post("/api/workspaces").send({ name: "Tokens" })).body
    .workspace.id;
  const tokenInvite = await owner
    .post(`/api/workspaces/${id}/invite`)
    .send({ email: "token-analyst@example.test", role: "analyst" });
  const rawInvite = tokenInvite.body.inviteUrl.split("/").pop();
  await analyst.post(`/api/invites/${rawInvite}/accept`);
  assert.equal(
    (
      await analyst
        .post(`/api/workspaces/${id}/invite`)
        .send({ email: "x@example.test", role: "viewer" })
    ).status,
    403,
  );
  assert.equal(
    (
      await analyst
        .post(`/api/workspaces/${id}/tokens`)
        .send({ name: "blocked" })
    ).status,
    403,
  );
  const created = await owner
    .post(`/api/workspaces/${id}/tokens`)
    .send({ name: "Desktop" });
  assert.equal(created.status, 201);
  const raw = created.body.token;
  const list = await owner.get(`/api/workspaces/${id}/tokens`);
  assert.equal(list.status, 200);
  assert.equal(list.body.tokens.length, 1);
  assert.equal(
    JSON.stringify(list.body),
    JSON.stringify(list.body).replaceAll(raw, ""),
  );
  assert.equal(JSON.stringify(list.body).includes("token_hash"), false);
  assert.equal(
    (await owner.delete(`/api/workspaces/${id}/tokens/${created.body.tokenId}`))
      .status,
    200,
  );
  assert.equal(
    (await owner.get(`/api/workspaces/${id}/tokens`)).body.tokens.length,
    0,
  );
});
