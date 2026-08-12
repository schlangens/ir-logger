const session = require("express-session");
class SQLiteSessionStore extends session.Store {
  constructor(db, { cleanupIntervalMs = 60 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    this.timer = setInterval(
      () =>
        this.db
          .prepare("DELETE FROM sessions WHERE expires_at <= ?")
          .run(Date.now()),
      cleanupIntervalMs,
    );
    this.timer.unref();
  }
  get(sid, cb) {
    try {
      const row = this.db
        .prepare("SELECT session_json, expires_at FROM sessions WHERE sid=?")
        .get(sid);
      if (!row || row.expires_at <= Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.session_json));
    } catch (e) {
      cb(e);
    }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + (sess.cookie?.maxAge || 86400000);
      this.db
        .prepare(
          "INSERT INTO sessions(sid,session_json,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET session_json=excluded.session_json,expires_at=excluded.expires_at",
        )
        .run(sid, JSON.stringify(sess), exp);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }
  destroy(sid, cb) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }
  touch(sid, sess, cb) {
    try {
      const exp = Date.now() + (sess.cookie?.maxAge || 86400000);
      this.db
        .prepare("UPDATE sessions SET expires_at=? WHERE sid=?")
        .run(exp, sid);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }
  stopCleanup() {
    clearInterval(this.timer);
  }
}
function createSessionStore(db, options) {
  return new SQLiteSessionStore(db, options);
}
module.exports = { createSessionStore, SQLiteSessionStore };
