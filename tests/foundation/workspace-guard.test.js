const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { db: makeDb } = require("./helpers");
const { createApp } = require("../../src/server");
const {
  resolveWorkspaceAccess,
} = require("../../src/middleware/workspace-guard");

test("a registered user cannot access another tenant", async (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const app = createApp(db, { startSweeper: false });
  const registration = await request(app).post("/api/auth/register").send({
    email: "member@example.test",
    name: "Member",
    password: "long-password",
  });
  const user = registration.body.user;
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(
    "other",
    "Other",
  );
  const result = resolveWorkspaceAccess(db, { user, session: {} }, "other");
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("a matching demo session gets owner-equivalent access", (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare("INSERT INTO workspaces (id, name, is_demo) VALUES (?, ?, 1)").run(
    "demo",
    "Demo",
  );
  assert.deepEqual(
    resolveWorkspaceAccess(
      db,
      { session: { demoWorkspaceId: "demo" } },
      "demo",
    ),
    { ok: true, role: "owner", isDemo: true },
  );
});

test("workspace lookup errors deny access without throwing", () => {
  const db = {
    prepare() {
      throw new Error("storage failure");
    },
  };
  const result = resolveWorkspaceAccess(
    db,
    { user: { id: "u" }, session: {} },
    "w",
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("real memberships report demo status", (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare("INSERT INTO workspaces (id, name, is_demo) VALUES (?, ?, 1)").run(
    "demo",
    "Demo",
  );
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
  ).run("u", "u@example.test", "U", "hash");
  db.prepare(
    "INSERT INTO memberships (user_id, workspace_id, role) VALUES (?, ?, ?)",
  ).run("u", "demo", "viewer");
  assert.deepEqual(
    resolveWorkspaceAccess(db, { user: { id: "u" }, session: {} }, "demo"),
    {
      ok: true,
      role: "viewer",
      isDemo: true,
    },
  );
});
