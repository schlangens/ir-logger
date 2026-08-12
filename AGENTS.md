# AGENTS.md — standing rules for any coding agent in this repo

Repo: `schlangens/ir-logger`. Read this file, `SPEC.md`, `DESIGN.md`, and
`ROADMAP.md` before writing any code. If your session was given a brief in
`docs/devin-briefs/`, read that too — it names the exact file set you own.

---

## 1. Fixed dependency list — no new dependency without justification

Node runtime dependencies (production):

```
express               ^5
express-session
passport
passport-local
passport-google-oauth20
bcrypt
better-sqlite3
helmet
multer
pdf-lib
nanoid
dotenv
```

Node dev dependencies:

```
supertest
```

**Minimum Node version: `>=22.12`, pinned via `"engines"` in
`package.json`.** This floor exists because `nanoid` (already on the
dependency list above, used for every generated id in this app) ships as
ESM-only starting at v5 — the app's CommonJS server code loads it via
dynamic `import()`, and that CJS-importing-ESM interop needs a
sufficiently current Node line to behave consistently. Do not lower this
floor to accommodate an older Node install; update the install instead.

(`node:test`, `node:crypto`, `node:fs`, `node:path`, `node:http` are Node
built-ins, not npm dependencies — use them freely, they aren't "new.")

Python (`ir-logger.py`) dependencies remain exactly `requirements.txt`
today: `tkinter` (stdlib, not pip-installable — the requirements.txt entry
is documentation only, same as v1), `pillow`. The desktop sync feature
(`SPEC.md` §2.10) is built on `urllib.request` (stdlib), not `requests`.

**Rule**: if you believe a capability genuinely needs a package not on
these lists (Node or Python), you may add it, but your PR description must
contain a section titled "New dependency justification" naming the
package and explaining, in one paragraph, why nothing already listed and
nothing in the Node/Python standard library can do it. A PR that adds a
dependency without that section will be sent back for revision. In
particular: do not add a rate-limiting package (`SPEC.md` §8.3 defines the
SQLite-backed approach), a session-store package (`SPEC.md` §4 defines the
SQLite-backed `sessions` table approach), a Markdown-rendering package
(`SPEC.md` §11 defines the hand-written subset), a WebSocket/Socket.IO
package (SSE only, native Express), or a cron/scheduler package (an
in-process interval is correct for this deployment shape — `SPEC.md` §9).

## 2. No build step

There is no bundler, no transpiler, no CSS preprocessor, and no frontend
package.json. `public/` is served as-is by `express.static`. Frontend code
is vanilla ES modules (`<script type="module">`) and plain CSS using custom
properties. Deploy is `git pull && pm2 restart ir-logger` — anything that
would require a build step to work in production is out of scope. Fonts
(`DESIGN.md`) are vendored static font files under `public/fonts/`, not
loaded from a CDN (the CSP in §3 below forbids external hosts anyway).

## 3. House conventions (match `../scrambler/src/server.js` and
`../scrambler/src/services/database.js`)

- Single `src/server.js` entry point that wires up `helmet`, `express.json()`,
  `express.urlencoded()`, `express-session`, `passport`, then mounts routers.
  `PORT` comes from `process.env.PORT`, defaulting to `3059`.
  `app.set('trust proxy', 1)` — trusting exactly **one** hop, because this
  app's real network path is `browser → nginx → Node` with nothing else
  in front of nginx (`SPEC.md` §8.8 has the full reasoning, including why
  this site is deliberately DNS-only rather than Cloudflare-proxied).
  `trust proxy: 1` is only correct because the paired nginx site
  **overwrites** `X-Forwarded-For` with the real peer address rather than
  appending to it — an appending config would let a direct client forge
  the header's left-most (trusted) entry and defeat every per-IP rate
  limiter in `SPEC.md`. The nginx config itself is outside any agent's
  file set (`AGENTS.md` §5 — never touch nginx config); verifying it
  actually overwrites rather than appends is a `ROADMAP.md` "before
  launch" operator checklist item, not something a session can confirm
  from inside this repo.
- Session cookie: `sameSite: 'lax'`. `'strict'` would break the working
  flow this app actually needs (a cross-site top-level `GET` redirect —
  Google's OAuth callback landing the browser back on this app's origin —
  needs the session cookie present to complete login; `'strict'` cookies
  are withheld on that exact request). `'lax'` is still sufficient CSRF
  protection here because every state-changing request in this app
  (`POST`/`PATCH`/`DELETE`) is issued by this app's own frontend via
  `fetch`, never by a cross-site HTML form post, an `<img>`/`<script>`
  tag, or any other simple cross-site request — `'lax'` only ever sends
  the cookie along on top-level, "safe-method" navigations, which is
  exactly the Google-redirect case and nothing riskier.
- `helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"],
  styleSrc: ["'self'"], fontSrc: ["'self'"], scriptSrc: ["'self'"], imgSrc:
  ["'self'", "data:"] } } })` — **self only, no external hosts**, and unlike
  scrambler's CSP (which allows Google Fonts) this app's fonts are
  self-hosted so `styleSrc`/`fontSrc` need no external allowance and no
  `'unsafe-inline'` for styles (inline `<style>` should not be needed given
  the CSS-custom-property token system in `DESIGN.md`; if a specific inline
  script is unavoidable, prefer moving it to a `<script type="module"
  src="...">` file over adding `'unsafe-inline'`).
- `better-sqlite3` opened once per process at
  `process.env.DB_PATH || path.join(__dirname, '../data/ir-logger.db')`,
  with `db.pragma('journal_mode = WAL')` set immediately after opening (per
  the handed-down architecture's WAL requirement).
  `db.pragma('foreign_keys = ON')` is also set immediately after opening —
  the DDL in `SPEC.md` uses `REFERENCES` and the app relies on real FK
  enforcement, unlike scrambler which doesn't declare FKs.
  Migrations run once at boot, before `app.listen()` (see `SPEC.md` §4).
- Services own all SQL (`db.prepare(...).run/get/all(...)`); routers never
  write raw SQL inline — same separation `scrambler`'s `services/database.js`
  vs `server.js` demonstrates, just split into one service module per
  resource (`src/services/incidents.js`, `src/services/entries.js`, etc.)
  rather than scrambler's single `database.js`, because this app has far
  more resource types.
  Cross-cutting concerns (workspace guard, rate limiting, audit-log
  append/verify, SSE broadcast, the session store) live in
  `src/middleware/` and `src/services/` as their own single-purpose
  modules, not folded into each resource's service file — this is what
  lets Round 2's four sub-briefs (`ROADMAP.md`) work on disjoint files
  concurrently.
- `passport.serializeUser`/`deserializeUser` store/restore the full user
  object shape `{ id, email, name }` exactly like scrambler's `(u, d) =>
  d(null, u)` pattern — no separate DB lookup on every request.
  `LocalStrategy` compares with `bcrypt.compare`. `GoogleStrategy` links or
  creates a `users` row (`SPEC.md` §5.2) — unlike scrambler's single
  hard-coded `ALLOWED_EMAIL`, this app has real multi-user registration, so
  there is no allowlist-of-one.
- `multer` uses **disk storage** (`multer.diskStorage`), not scrambler's
  memory storage — evidence files can be large and must be streamed to
  disk while hashing (`SPEC.md` §7), not buffered fully in memory first.
  `limits.fileSize` is enforced per the caps in `SPEC.md` §5.7.
- Error handling: a Multer error-handling middleware placed after the
  upload routes, same position/pattern as scrambler's, translating
  `LIMIT_FILE_SIZE` etc. into the `{ error }` JSON shape from `SPEC.md` §5.
- Route files return early with `res.status(...).json({ error })` on guard
  failure — no thrown exceptions used for expected control flow (matches
  scrambler's style of explicit early returns).

## 4. Fail-closed stances (restated — see `SPEC.md` §8 for full detail)

- The workspace guard denies (`403`/`404`) on missing/failed lookups. It
  never falls back to "assume the caller's only workspace."
- Rate limiters and the demo-creation guard deny (`503`) if their own
  SQLite-backed state can't be read/written. They never fail open.
- `audit_log` **and `custody_events`** are both append-only. Grep for
  `UPDATE audit_log` / `DELETE FROM audit_log` and `UPDATE custody_events`
  / `DELETE FROM custody_events` before opening a PR that touches
  anything audit- or custody-related — there must be zero matches outside
  of test-fixture raw SQL explicitly commented as such (`SPEC.md` §8.4).
  Evidence access (view/download) is written to `custody_events` **and**
  `audit_log` for the same event — one without the other is a bug
  (`SPEC.md` §2.3).
- Evidence downloads always use `application/octet-stream` and
  `Content-Disposition: attachment`, never the uploaded file's declared
  `mime` (`SPEC.md` §7).
- Auth, workspace-membership, and input-validation checks run, in that
  order, before any database write, file write, or SSE broadcast.
- **Any route that resolves a single resource by its own bare id — no
  workspace or incident segment in the URL (e.g. `GET /api/entries/:id`,
  `GET /api/evidence/:id` and its `/download`/`/custody` siblings) — must
  ship with an explicit test asserting that fetching a resource belonging
  to a workspace the caller is not a member of returns `404`.** This
  shape of route is the textbook place an IDOR-by-omission bug hides:
  it's easy to write the happy path against the guard and forget the
  cross-tenant case specifically, since nothing about the URL itself
  hints that a resolution step is needed. `SPEC.md` §5.5 and §5.7 spell
  out the exact resolution path (child id → its parent's `workspace_id` →
  `workspace-guard.js`) for the routes that exist today; the same rule
  applies to any bare-id route added later.

## 5. Git workflow

- Never push to `main`. Always create a branch (`git checkout -b
  <descriptive-name>`) and open a PR. Do not merge your own PR.
- Never restart `pm2`, never touch a live/production database, never send
  email (real or test — no SMTP/API call to any email provider, including
  from a script, a test, or a manual "let me just verify this works"
  action), never modify nginx config or DNS. These are outside every
  session's scope regardless of what the task seems to imply is needed;
  if you believe one of these is genuinely required to complete your
  brief, stop and say so in the PR description instead of doing it.
- Run `npm test` before opening the PR, and paste its full output in the
  PR description (not a summary of it — the actual output).

## 6. Required PR evidence checklist

Every PR description must include, in this order:

1. **What changed** — plain list of files touched and why, one line each.
2. **Tests run** — the exact command (`npm test`, or the specific
   `node --test tests/<dir>` if scoped) and its full pasted output,
   including the pass/fail summary line.
3. **Screenshots** — required for any change touching `public/` (any UI).
   At minimum: the loading, empty, error, and success states you touched,
   at both a desktop width (≥1280px) and a phone width (375px). Not
   required for pure-backend PRs with no UI change.
4. **SPEC.md sections implemented** — list the section numbers (e.g. "§5.4
   Incidents", "§2.4 status workflow") your PR delivers.
5. **What was deliberately left out** — anything in your brief's scope you
   did not implement and why (e.g. "left `note`-kind technique validation
   out of scope per §5.5, which says technique_ids are only meaningful for
   `technical` entries").

## 7. File ownership

Each Devin session in `docs/devin-briefs/` is scoped to an explicit file
set. Stay strictly inside your brief's owned-files list. If finishing your
task seems to require editing a file another brief owns (including any
Round 1 foundation file), that is a signal to stop and flag it in the PR
description rather than editing it — foundation files in particular
(`src/middleware/workspace-guard.js`, `src/services/audit.js`,
`src/services/session-store.js`, `src/middleware/rate-limit.js`,
`src/sse/hub.js`, `src/db/*`) are imported and used by every later round,
never modified by them. If your brief's acceptance criteria turn out to be
impossible without a change to a file you don't own, say so explicitly in
the PR rather than making the edit anyway.
