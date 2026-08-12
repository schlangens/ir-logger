const router = require("express").Router();
router.get("/health", (req, res) => {
  try {
    req.app.locals.db.prepare("SELECT 1").get();
    res.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      db: "ok",
    });
  } catch (e) {
    res.status(503).json({ status: "error", db: "error" });
  }
});
module.exports = router;
