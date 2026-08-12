const router = require("express").Router();
const passport = require("passport");
const crypto = require("node:crypto");
const { nanoid } = require("nanoid");
const { hashPassword } = require("../auth/passport");
const { rateLimit } = require("../middleware/rate-limit");
const registrationLimit = rateLimit({
  bucket: "registration",
  max: 5,
  windowMs: 60 * 60 * 1000,
});
const loginLimit = rateLimit({
  bucket: "login",
  max: 10,
  windowMs: 15 * 60 * 1000,
  countMode: "failures",
});
const userShape = (u) => ({ id: u.id, email: u.email, name: u.name });
function regenerate(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
}
router.post("/register", registrationLimit, async (req, res, next) => {
  const db = req.app.locals.db;
  const { email, name, password } = req.body || {};
  if (!email || !name || !password || password.length < 10)
    return res.status(400).json({
      error: "Email, name, and password of at least 10 characters are required",
    });
  try {
    if (
      db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email)
    )
      return res.status(400).json({ error: "Email already registered" });
    const id = nanoid(16),
      hash = await hashPassword(password);
    db.prepare(
      "INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)",
    ).run(id, email, name, hash);
    await regenerate(req);
    req.login({ id, email, name }, (e) =>
      e ? next(e) : res.status(201).json({ user: { id, email, name } }),
    );
  } catch (e) {
    next(e);
  }
});
router.post("/login", loginLimit, (req, res, next) =>
  passport.authenticate("local", (err, user) => {
    if (err) return next(err);
    if (!user) {
      req.rateLimit?.recordFailure();
      return res.status(401).json({ error: "Invalid credentials" });
    }
    regenerate(req)
      .then(() =>
        req.login(user, (e) =>
          e ? next(e) : res.json({ user: userShape(user) }),
        ),
      )
      .catch(next);
  })(req, res, next),
);
router.post("/logout", (req, res, next) =>
  req.logout((e) => (e ? next(e) : res.json({ success: true }))),
);
router.get("/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return res.status(503).json({ error: "Google authentication unavailable" });
  passport.authenticate("google", { scope: ["profile", "email"] })(
    req,
    res,
    next,
  );
});
router.get("/google/callback", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return res.status(503).json({ error: "Google authentication unavailable" });
  passport.authenticate("google", (err, user) => {
    if (err || !user) return res.redirect("/login?error=1");
    regenerate(req)
      .then(() => req.login(user, (e) => (e ? next(e) : res.redirect("/"))))
      .catch(next);
  })(req, res, next);
});
router.get("/session", (req, res) => {
  try {
    if (!req.user) return res.json({ user: null, workspaces: [] });
    const rows = req.app.locals.db
      .prepare(
        "SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY w.created_at",
      )
      .all(req.user.id);
    res.json({ user: userShape(req.user), workspaces: rows });
  } catch (e) {
    res.json({ user: req.user ? userShape(req.user) : null, workspaces: [] });
  }
});
module.exports = router;
