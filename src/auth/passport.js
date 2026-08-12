const bcrypt = require("bcrypt");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { nanoid } = require("nanoid");
const hashPassword = (password) => bcrypt.hash(password, 12);
function configurePassport(db) {
  passport.use(
    new LocalStrategy({ usernameField: "email" }, (email, password, done) => {
      try {
        const row = db
          .prepare(
            "SELECT id,email,name,password_hash FROM users WHERE lower(email)=lower(?)",
          )
          .get(email);
        if (!row || !row.password_hash) return done(null, false);
        bcrypt
          .compare(password, row.password_hash)
          .then((ok) =>
            done(
              null,
              ok ? { id: row.id, email: row.email, name: row.name } : false,
            ),
          )
          .catch(done);
      } catch (e) {
        done(e);
      }
    }),
  );
  passport.serializeUser((u, d) =>
    d(null, { id: u.id, email: u.email, name: u.name }),
  );
  passport.deserializeUser((u, d) => d(null, u));
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${process.env.BASE_URL || "https://ir.scottslab.io"}/api/auth/google/callback`,
        },
        (access, refresh, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value?.toLowerCase();
            if (!email) return done(null, false);
            let user = db
              .prepare("SELECT id,email,name FROM users WHERE google_id=?")
              .get(profile.id);
            if (user) return done(null, user);
            user = db
              .prepare("SELECT id,email,name FROM users WHERE lower(email)=?")
              .get(email);
            if (user) {
              db.prepare("UPDATE users SET google_id=? WHERE id=?").run(
                profile.id,
                user.id,
              );
              return done(null, user);
            }
            const id = nanoid(16);
            db.prepare(
              "INSERT INTO users(id,email,name,google_id) VALUES(?,?,?,?)",
            ).run(id, email, profile.displayName || email, profile.id);
            done(null, { id, email, name: profile.displayName || email });
          } catch (e) {
            done(e);
          }
        },
      ),
    );
  return passport;
}
module.exports = { configurePassport, hashPassword };
