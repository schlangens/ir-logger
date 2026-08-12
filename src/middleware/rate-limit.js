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
  return {
    allowed: row.count <= max,
    count: row.count,
    retryAfterSeconds: Math.max(1, Math.ceil((ws + windowMs - Date.now()) / 1000)),
  };
}

function peek(db, { bucketKey, max, windowMs }) {
  const ws = windowStart(windowMs);
  const row = db
    .prepare('SELECT count FROM rate_limits WHERE bucket_key=? AND window_start=?')
    .get(bucketKey, ws);
  const count = row?.count || 0;
  return {
    allowed: count < max,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((ws + windowMs - Date.now()) / 1000)),
  };
}

function rateLimit({ bucket, max, windowMs, keyFn = (req) => req.ip, countMode = 'all' }) {
  return (req, res, next) => {
    try {
      const key = `${bucket}:${keyFn(req)}`;
      const args = { bucketKey: key, max, windowMs };
      const result =
        countMode === 'failures' ? peek(req.app.locals.db, args) : consume(req.app.locals.db, args);
      if (!result.allowed) {
        res.set('Retry-After', String(result.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many requests' });
      }
      if (countMode === 'failures') {
        req.rateLimit = {
          recordFailure: () => {
            try {
              consume(req.app.locals.db, args);
            } catch (_) {
              /* failure is recorded best-effort after the response */
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

module.exports = { rateLimit, consume, peek };
