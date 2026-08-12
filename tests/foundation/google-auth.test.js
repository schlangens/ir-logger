const test = require('node:test');
const assert = require('node:assert/strict');
const { db: makeDb } = require('./helpers');
const { resolveGoogleUser } = require('../../src/auth/passport');

function captureWarnings(callback) {
  const originalWarn = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    return { result: callback(), lines };
  } finally {
    console.warn = originalWarn;
  }
}

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
  const { result: user, lines } = captureWarnings(() => resolveGoogleUser(db, profileWith(true)));
  assert.notEqual(user, false);
  assert.deepEqual(lines, []);
  assert.equal(user.email, 'googler@example.test');
  assert.equal(
    db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1') !== undefined,
    true,
  );
});

test('an already-linked verified profile is accepted without diagnostics', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO users (id, email, name, google_id) VALUES (?, ?, ?, ?)').run(
    'linked-user',
    'linked@example.test',
    'Linked',
    'google-1',
  );
  const { result, lines } = captureWarnings(() =>
    resolveGoogleUser(db, {
      id: 'google-1',
      displayName: 'Googler',
      emails: [{ value: 'linked@example.test', verified: true }],
    }),
  );
  assert.equal(result.id, 'linked-user');
  assert.deepEqual(lines, []);
});

test('an existing local account is linked without diagnostics', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    'local-user',
    'link@example.test',
    'Local',
    'hash',
  );
  const { result, lines } = captureWarnings(() =>
    resolveGoogleUser(db, {
      id: 'google-link',
      displayName: 'Googler',
      emails: [{ value: 'link@example.test', verified: true }],
    }),
  );
  assert.equal(result.id, 'local-user');
  assert.deepEqual(lines, []);
});

test('a profile with verified: false is denied and creates no user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const { result, lines } = captureWarnings(() => resolveGoogleUser(db, profileWith(false)));
  assert.equal(result, false);
  assert.match(lines[0], /reason=unverified_email/);
  assert.match(lines[0], /profilePreviouslyLinked=false/);
  assert.equal(
    lines.some((line) => line.includes('googler@example.test')),
    false,
  );
  assert.equal(db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1'), undefined);
});

test('a profile without a usable email is denied with a diagnostic', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const { result, lines } = captureWarnings(() =>
    resolveGoogleUser(db, { id: 'google-no-email', displayName: 'No Email', emails: [] }),
  );
  assert.equal(result, false);
  assert.match(lines[0], /reason=no_usable_email/);
  assert.match(lines[0], /profileId=google-no-email/);
  assert.match(lines[0], /localAccount=not_applicable/);
  assert.match(lines[0], /profilePreviouslyLinked=false/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});

test('a profile with a missing verified flag is denied and creates no user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const profile = {
    id: 'google-1',
    displayName: 'Googler',
    emails: [{ value: 'googler@example.test' }],
  };
  const { result, lines } = captureWarnings(() => resolveGoogleUser(db, profile));
  assert.equal(result, false);
  assert.match(lines[0], /reason=unverified_email/);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE google_id = ?').get('google-1'), undefined);
});

test('a profile with a non-boolean verified flag is denied and creates no user', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const { result, lines } = captureWarnings(() => resolveGoogleUser(db, profileWith('true')));
  assert.equal(result, false);
  assert.match(lines[0], /reason=unverified_email/);
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
  const { result, lines } = captureWarnings(() => resolveGoogleUser(db, profileWith(false)));
  assert.equal(result, false);
  assert.match(lines[0], /localAccount=true/);
  assert.match(lines[0], /profilePreviouslyLinked=false/);
  const existing = db.prepare('SELECT google_id FROM users WHERE id = ?').get('existing-user');
  assert.equal(existing.google_id, null);
});

test('an unverified already-linked profile is identified as previously linked', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  db.prepare('INSERT INTO users (id, email, name, google_id) VALUES (?, ?, ?, ?)').run(
    'linked-user',
    'previous@example.test',
    'Previously Linked',
    'google-linked',
  );
  const { result, lines } = captureWarnings(() =>
    resolveGoogleUser(db, {
      id: 'google-linked',
      displayName: 'Previously Linked',
      emails: [{ value: 'previous@example.test', verified: false }],
    }),
  );
  assert.equal(result, false);
  assert.match(lines[0], /reason=unverified_email/);
  assert.match(lines[0], /profilePreviouslyLinked=true/);
  assert.equal(
    lines.some((line) => line.includes('previous@example.test')),
    false,
  );
  assert.equal(
    db.prepare('SELECT google_id FROM users WHERE id=?').get('linked-user').google_id,
    'google-linked',
  );
});

test('an unverified primary email with a verified secondary is diagnosed explicitly', (t) => {
  const { db } = makeDb();
  t.after(() => db.close());
  const profile = {
    id: 'google-secondary',
    displayName: 'Secondary',
    emails: [
      { value: 'primary@example.test', verified: false },
      { value: 'secondary@example.test', verified: true },
    ],
  };
  const { result, lines } = captureWarnings(() => resolveGoogleUser(db, profile));
  assert.equal(result, false);
  assert.match(lines[0], /reason=unverified_primary_with_verified_secondary/);
  assert.equal(
    lines.some((line) => line.includes('primary@example.test')),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes('secondary@example.test')),
    false,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});
