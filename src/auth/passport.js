const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { nanoid } = require('nanoid');
const hashPassword = (password) => bcrypt.hash(password, 12);
const DUMMY_PASSWORD_HASH = '$2b$12$OMlK4xPY06neMxOFsN2CwOPkJiVsbtRgxI6jKZrkWRmd9fsvTwlr6';
function configurePassport(db) {
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
      try {
        const row = db
          .prepare('SELECT id,email,name,password_hash FROM users WHERE email=?')
          .get(email);
        const passwordHash = row?.password_hash || DUMMY_PASSWORD_HASH;
        bcrypt
          .compare(password, passwordHash)
          .then((ok) =>
            done(
              null,
              ok && row?.password_hash ? { id: row.id, email: row.email, name: row.name } : false,
            ),
          )
          .catch(done);
      } catch (e) {
        done(e);
      }
    }),
  );
  passport.serializeUser((u, d) => d(null, { id: u.id, email: u.email, name: u.name }));
  passport.deserializeUser((u, d) => d(null, u));
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${process.env.BASE_URL || 'https://ir.scottslab.io'}/api/auth/google/callback`,
        },
        (access, refresh, profile, done) => {
          try {
            done(null, resolveGoogleUser(db, profile));
          } catch (e) {
            done(e);
          }
        },
      ),
    );
  return passport;
}

// Resolves (or creates) the local user for a Google profile, or returns
// `false` to deny. Exported separately from the strategy callback above so
// it can be exercised directly in tests without driving a full OAuth
// handshake.
function resolveGoogleUser(db, profile) {
  const { email, verified, emails } = readGoogleEmail(profile);
  if (!email) {
    logGoogleDeny(db, profile, 'no_usable_email', undefined, emails);
    return false;
  }
  // Google's profile reports whether the account holder has actually
  // verified control of this address (`email_verified` on the raw profile,
  // surfaced here as `emails[0].verified`). An unverified address is not
  // proof of control of that mailbox, and this app links/creates accounts
  // by email — accepting an unverified one would let an identity that
  // doesn't actually control the mailbox land on (or create) an account for
  // that email. Fail closed: only an explicit `true` is accepted; anything
  // absent, malformed, or falsy is denied.
  if (verified !== true) {
    logGoogleDeny(db, profile, 'unverified_email', email, emails);
    return false;
  }
  let user = db
    .prepare('SELECT id,email,name,is_demo FROM users WHERE google_id=?')
    .get(profile.id);
  if (user) return user.is_demo === 1 ? false : user;
  user = db.prepare('SELECT id,email,name,is_demo FROM users WHERE email=?').get(email);
  if (user) {
    if (user.is_demo === 1) return false;
    db.prepare('UPDATE users SET google_id=? WHERE id=?').run(profile.id, user.id);
    return user;
  }
  const id = nanoid(16);
  db.prepare('INSERT INTO users(id,email,name,google_id) VALUES(?,?,?,?)').run(
    id,
    email,
    profile.displayName || email,
    profile.id,
  );
  return { id, email, name: profile.displayName || email };
}

function readGoogleEmail(profile) {
  try {
    const emails = profile?.emails;
    const primary = emails?.[0];
    const value = primary?.value;
    return {
      email: typeof value === 'string' ? value.toLowerCase() : undefined,
      verified: primary?.verified,
      emails,
    };
  } catch (_) {
    return { email: undefined, verified: undefined, emails: undefined };
  }
}

function digestGoogleValue(value) {
  try {
    const normalized = typeof value === 'string' ? value : String(value ?? '');
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  } catch (_) {
    return 'unavailable';
  }
}

function logGoogleDeny(db, profile, reason, email, emails) {
  try {
    let localAccount = 'unknown';
    let profilePreviouslyLinked = 'unknown';
    let profileId;
    try {
      profileId = profile?.id;
    } catch (_) {}
    try {
      if (email) {
        localAccount =
          db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email) !== undefined;
      } else {
        localAccount = 'not_applicable';
      }
      profilePreviouslyLinked =
        Boolean(profileId) &&
        db.prepare('SELECT 1 FROM users WHERE google_id=?').get(profileId) !== undefined;
    } catch (_) {}
    const secondaryVerified =
      reason === 'unverified_email' &&
      Array.isArray(emails) &&
      emails.slice(1).some((entry) => entry?.verified === true);
    const diagnosticReason = secondaryVerified
      ? 'unverified_primary_with_verified_secondary'
      : reason;
    const emailDigest = email ? crypto.createHash('sha256').update(email).digest('hex') : 'none';
    console.warn(
      `[google-auth] deny reason=${diagnosticReason} localAccount=${localAccount} profilePreviouslyLinked=${profilePreviouslyLinked} profileIdSha256=${digestGoogleValue(profileId)} emailSha256=${emailDigest}`,
    );
  } catch (_) {}
}

module.exports = { configurePassport, hashPassword, resolveGoogleUser };
