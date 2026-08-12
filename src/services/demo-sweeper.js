function sweep(db) {
  // Round 2e replaces this no-op body (SPEC §9 point 4).
  return undefined;
}
function start(db, { intervalMs = 15 * 60 * 1000 } = {}) {
  const timer = setInterval(() => sweep(db), intervalMs);
  timer.unref();
  return timer;
}
module.exports = { start, sweep };
