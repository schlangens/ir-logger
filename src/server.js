require('dotenv').config({ quiet: true });
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const helmet = require('helmet');
const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const { getDb, openDatabase, runMigrations } = require('./db');
const { createSessionStore } = require('./services/session-store');
const { configurePassport } = require('./auth/passport');
const sweeper = require('./services/demo-sweeper');
const auth = require('./routes/auth');
const health = require('./routes/health');
const workspaces = require('./routes/workspaces');

function createApp(db, opts = {}) {
  if (!db) {
    db = getDb();
  }
  const app = express();
  app.set('trust proxy', 1);
  app.locals.db = db;
  configurePassport(db);
  const secret =
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));
  if (!secret) throw new Error('SESSION_SECRET is required in production');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'"],
          fontSrc: ["'self'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true }));
  const store = createSessionStore(db, opts.sessionStore);
  app.locals.sessionStore = store;
  app.use(
    session({
      secret,
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(express.static(path.join(__dirname, '../public')));
  // The invite link the server hands out (POST /api/workspaces/:id/invite,
  // routes/workspaces.js) is shaped `/invite/<token>` — a path segment, for
  // the cleaner, more shareable URL — but express.static above only serves
  // the literal file /invite.html, nothing serves that path shape. This
  // serves that same page at the pretty URL the link actually uses; the
  // client (public/js/auth.js's initInvite) reads the token back out of
  // the path. Kept as a plain route here rather than a new router module —
  // it's a single static-file response, not a resource with its own
  // business logic.
  app.get('/invite/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/invite.html'));
  });
  app.use('/api/auth', auth);
  app.use('/', health);
  app.use('/', require('./routes/downloads'));
  app.use('/api', workspaces);
  app.use('/api', require('./routes/incidents'));
  app.use('/api', require('./routes/entries'));
  app.use('/api', require('./routes/search'));
  app.use('/api', require('./routes/v1-ingest'));
  app.use('/api', require('./routes/techniques'));
  app.use('/api', require('./routes/evidence'));
  app.use('/api', require('./routes/export'));
  app.use('/api', require('./routes/audit'));
  app.use('/api', require('./routes/demo'));
  if (opts.startSweeper !== false) sweeper.start(db);
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request body too large' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    if (error instanceof multer.MulterError)
      return res
        .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ error: error.message });
    next(error);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
if (require.main === module) {
  const db = openDatabase();
  runMigrations(db);
  const app = createApp(db);
  app.listen(process.env.PORT || 3059, '127.0.0.1', () =>
    console.log(`ir-logger listening on ${process.env.PORT || 3059}`),
  );
}
module.exports = { createApp };
