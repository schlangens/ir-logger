const router = require('express').Router();
const passport = require('passport');
const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const { hashPassword } = require('../auth/passport');
const { rateLimit } = require('../middleware/rate-limit');
const registrationLimit = rateLimit({
  bucket: 'registration',
  max: 5,
  windowMs: 60 * 60 * 1000,
});
const loginLimit = rateLimit({
  bucket: 'login',
  max: 10,
  windowMs: 15 * 60 * 1000,
  countMode: 'refund-on-success',
});
const userShape = (u) => ({ id: u.id, email: u.email, name: u.name });
// Named to avoid colliding with the unrelated `hash` (bcrypt password hash)
// local variable already declared inside the /register handler below.
const hashToken = (s) => crypto.createHash('sha256').update(s).digest('hex');
function regenerate(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
}
// REGISTRATION_OPEN gates public sign-up on this instance. It defaults to
// open (unset, or set to anything other than the literal string "false")
// so that a stranger who clones this repo and runs it with zero
// configuration still gets a working sign-up — that clone-and-run
// property is the whole point of an open-source showcase. The live
// deployment sets it to "false" once it has real users.
function registrationOpen() {
  return process.env.REGISTRATION_OPEN !== 'false';
}
// Closing public registration must not lock a workspace owner out of ever
// adding a colleague: accepting an invite (POST /api/invites/:token/accept,
// in workspaces.js) requires an existing session, and that session can
// only come from an account whose email exactly matches the invite — so a
// brand-new invitee has no way to get that account once registration is
// closed. This looks up a pending, unexpired, unaccepted invite for the
// exact email being registered and, if found, lets that one registration
// through regardless of REGISTRATION_OPEN. It never reports *why* a token
// didn't qualify (missing, expired, wrong email, already used) — same
// generic rejection as any other closed attempt.
function findValidInviteForEmail(db, token, normalizedEmail) {
  if (typeof token !== 'string' || !token) return null;
  const invite = db.prepare('SELECT * FROM invites WHERE token_hash=?').get(hashToken(token));
  if (!invite || invite.accepted_at || new Date(invite.expires_at) <= new Date()) return null;
  if (invite.email !== normalizedEmail) return null;
  return invite;
}
router.post('/register', registrationLimit, async (req, res, next) => {
  const db = req.app.locals.db;
  const { email, name, password, invite_token } = req.body || {};
  if (
    typeof email !== 'string' ||
    typeof name !== 'string' ||
    typeof password !== 'string' ||
    (invite_token !== undefined && typeof invite_token !== 'string') ||
    !email ||
    !name ||
    password.length < 10 ||
    email.length > 320 ||
    name.length > 200 ||
    password.length > 1024 ||
    (typeof invite_token === 'string' && invite_token.length > 200)
  )
    return res.status(400).json({
      error: 'Email, name, and password of at least 10 characters are required',
    });
  const normalizedEmail = email.toLowerCase();
  if (!registrationOpen() && !findValidInviteForEmail(db, invite_token, normalizedEmail)) {
    return res.status(403).json({
      error:
        'This instance is not accepting public sign-ups right now. Try the live demo instead, or self-host the project from its source on GitHub.',
    });
  }
  try {
    if (db.prepare('SELECT id FROM users WHERE email=?').get(normalizedEmail))
      return res.status(400).json({ error: 'Email already registered' });
    const id = nanoid(16),
      hash = await hashPassword(password);
    db.prepare('INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)').run(
      id,
      normalizedEmail,
      name,
      hash,
    );
    await regenerate(req);
    req.login({ id, email: normalizedEmail, name }, (e) =>
      e ? next(e) : res.status(201).json({ user: { id, email: normalizedEmail, name } }),
    );
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE')
      return res.status(400).json({ error: 'Email already registered' });
    next(e);
  }
});
router.post('/login', loginLimit, (req, res, next) => {
  if (
    typeof req.body?.email !== 'string' ||
    typeof req.body?.password !== 'string' ||
    req.body.email.length > 320 ||
    req.body.password.length > 1024
  )
    return res.status(400).json({ error: 'Email and password are required' });
  return passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    regenerate(req)
      .then(() => {
        req.rateLimit?.refund();
        return req.login(user, (e) => (e ? next(e) : res.json({ user: userShape(user) })));
      })
      .catch(next);
  })(req, res, next);
});
router.post('/logout', (req, res, next) =>
  req.logout((e) => {
    if (e) return next(e);
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  }),
);
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return res.status(503).json({ error: 'Google authentication unavailable' });
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
router.get('/google/callback', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return res.status(503).json({ error: 'Google authentication unavailable' });
  passport.authenticate('google', (err, user) => {
    if (err || !user) return res.redirect('/login?error=1');
    regenerate(req)
      .then(() => req.login(user, (e) => (e ? next(e) : res.redirect('/'))))
      .catch(next);
  })(req, res, next);
});
router.get('/session', (req, res) => {
  // `google_enabled` reveals only whether Google sign-in is wired up on the
  // server (the same condition that gates the strategy in auth/passport.js
  // and the /google, /google/callback routes above) — never the client id,
  // the secret, or anything else about the configuration. This is the
  // frontend's only way to know, so the "Continue with Google" button can
  // hide itself instead of pointing at a route that isn't there.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  // `registration_open` reflects REGISTRATION_OPEN (defined above); it is
  // how login.html/register.html/index.html decide whether to show a
  // "create an account" affordance instead of one that would 403.
  const registrationIsOpen = registrationOpen();
  try {
    if (!req.user)
      return res.json({
        user: null,
        workspaces: [],
        google_enabled: googleEnabled,
        registration_open: registrationIsOpen,
      });
    const rows = req.app.locals.db
      .prepare(
        'SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY w.created_at',
      )
      .all(req.user.id);
    res.json({
      user: userShape(req.user),
      workspaces: rows,
      google_enabled: googleEnabled,
      registration_open: registrationIsOpen,
    });
  } catch (e) {
    // Session lookup errors are swallowed because this endpoint always returns 200.
    res.json({
      user: req.user ? userShape(req.user) : null,
      workspaces: [],
      google_enabled: googleEnabled,
      registration_open: registrationIsOpen,
    });
  }
});
module.exports = router;
