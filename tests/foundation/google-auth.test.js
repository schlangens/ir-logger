const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('./helpers');
const { resolveGoogleUser } = require('../../src/auth/passport');

function profileWith(verified) {
  return {
    id: 'google-1',
    displayName: 'Googler',
    emails: [{ value: 'googler@example.test', verified }],
  };
}

test('a profile with a verified email is accepted and creates a user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const user = resolveGoogleUser(db, profileWith(true));
  assert.notEqual(user, false);
  assert.equal(user.email, 'googler@example.test');
  assert.equal(
    db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1') !== undefined,
    true,
  );
});

test('a profile with verified: false is denied and creates no user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const result = resolveGoogleUser(db, profileWith(false));
  assert.equal(result, false);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1'), undefined);
});

test('a profile with a missing verified flag is denied and creates no user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const profile = {
    id: 'google-1',
    displayName: 'Googler',
    emails: [{ value: 'googler@example.test' }],
  };
  const result = resolveGoogleUser(db, profile);
  assert.equal(result, false);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1'), undefined);
});

test('a profile with a non-boolean verified flag is denied and creates no user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const result = resolveGoogleUser(db, profileWith('true'));
  assert.equal(result, false);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1'), undefined);
});

test('an unverified Google profile cannot link to an existing account by email', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    'existing-user',
    'googler@example.test',
    'Existing',
    'hash',
  );
  const result = resolveGoogleUser(db, profileWith(false));
  assert.equal(result, false);
  const existing = db.prepare('SELECT google_id FROM users WHERE id = ?').get('existing-user');
  assert.equal(existing.google_id, null);
});
