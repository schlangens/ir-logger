let lastPurgeAt = 0;
let lastGlobalPurgeAt = 0;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

function windowStart(windowMs) {
  return Math.floor(Date.now() / windowMs) * windowMs;
}

function consume(db, { bucketKey, max, windowMs }) {
  const ws = windowStart(windowMs);
  const row = db
    .prepare(
      `INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket_key, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .get(bucketKey, ws);
  if (Date.now() - lastPurgeAt >= 60 * 1000) {
    lastPurgeAt = Date.now();
    try {
      db.prepare('DELETE FROM rate_limits WHERE bucket_key = ? AND window_start < ?').run(
        bucketKey,
        ws,
      );
    } catch (_) {
      // Purging stale buckets is best-effort and must not weaken the limiter's fail-closed check.
    }
  }
  if (Date.now() - lastGlobalPurgeAt >= 5 * 60 * 1000) {
    lastGlobalPurgeAt = Date.now();
    try {
      db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(Date.now() - MAX_WINDOW_MS);
    } catch (_) {
      // Global stale-row cleanup is best-effort and never weakens the limiter.
    }
  }
  return {
    allowed: row.count <= max,
    count: row.count,
    windowStart: ws,
    retryAfterSeconds: Math.max(1, Math.ceil((ws + windowMs - Date.now()) / 1000)),
  };
}

// `refund-on-success` consumes every attempt and exposes `req.rateLimit.refund()`.
function rateLimit({ bucket, max, windowMs, keyFn = (req) => req.ip, countMode = 'all' }) {
  return (req, res, next) => {
    try {
      const key = `${bucket}:${keyFn(req)}`;
      const args = { bucketKey: key, max, windowMs };
      const result = consume(req.app.locals.db, args);
      if (!result.allowed) {
        res.set('Retry-After', String(result.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many requests' });
      }
      if (countMode === 'refund-on-success') {
        req.rateLimit = {
          refund: () => {
            try {
              req.app.locals.db
                .prepare('DELETE FROM rate_limits WHERE bucket_key=? AND window_start=?')
                .run(args.bucketKey, result.windowStart);
            } catch (_) {
              // A failed refund costs one budget attempt but must never fail login.
            }
          },
        };
      }
      next();
    } catch (error) {
      // Fail closed: rate-limit storage errors deny requests rather than allowing unbounded traffic.
      return res.status(503).json({ error: 'Rate limiter unavailable' });
    }
  };
}

module.exports = { rateLimit, consume, MAX_WINDOW_MS };
