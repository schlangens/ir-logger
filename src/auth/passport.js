const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { nanoid } = require('nanoid');
const hashPassword = (password) => bcrypt.hash(password, 12);
function configurePassport(db) {
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
      try {
        const row = db
          .prepare('SELECT id,email,name,password_hash FROM users WHERE lower(email)=lower(?)')
          .get(email);
        if (!row || !row.password_hash) return done(null, false);
        bcrypt
          .compare(password, row.password_hash)
          .then((ok) => done(null, ok ? { id: row.id, email: row.email, name: row.name } : false))
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
  const email = profile?.emails?.[0]?.value?.toLowerCase();
  if (!email) {
    logGoogleDeny(db, profile, 'no_usable_email');
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
  if (profile?.emails?.[0]?.verified !== true) {
    logGoogleDeny(db, profile, 'unverified_email', email);
    return false;
  }
  let user = db.prepare('SELECT id,email,name FROM users WHERE google_id=?').get(profile.id);
  if (user) return user;
  user = db.prepare('SELECT id,email,name FROM users WHERE lower(email)=?').get(email);
  if (user) {
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

function logGoogleDeny(db, profile, reason, email) {
  try {
    let localAccount = 'unknown';
    let profilePreviouslyLinked = 'unknown';
    try {
      if (email) {
        localAccount =
          db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email) !== undefined;
      } else {
        localAccount = 'not_applicable';
      }
      profilePreviouslyLinked =
        Boolean(profile?.id) &&
        db.prepare('SELECT 1 FROM users WHERE google_id=?').get(profile.id) !== undefined;
    } catch (_) {}
    const secondaryVerified =
      reason === 'unverified_email' &&
      Array.isArray(profile?.emails) &&
      profile.emails.slice(1).some((entry) => entry?.verified === true);
    const diagnosticReason = secondaryVerified
      ? 'unverified_primary_with_verified_secondary'
      : reason;
    const emailDigest = email ? crypto.createHash('sha256').update(email).digest('hex') : 'none';
    console.warn(
      `[google-auth] deny reason=${diagnosticReason} profileId=${String(
        profile?.id ?? 'unknown',
      )} emailSha256=${emailDigest} localAccount=${localAccount} profilePreviouslyLinked=${profilePreviouslyLinked}`,
    );
  } catch (_) {}
}

module.exports = { configurePassport, hashPassword, resolveGoogleUser };
