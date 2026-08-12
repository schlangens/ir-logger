const test = require("node:test");
const assert = require("node:assert/strict");
const { db: makeDb } = require("./helpers");
const { runMigrations } = require("../../src/db");

test("migrations are idempotent and seed 50 techniques", (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT count(*) AS n FROM techniques").get().n, 50);
  runMigrations(db);
  assert.equal(db.prepare("SELECT count(*) AS n FROM techniques").get().n, 50);
});
