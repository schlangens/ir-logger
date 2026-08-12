---
name: testing-ir-logger-api
description: How to boot and exercise the ir-logger Express/better-sqlite3 backend end-to-end with curl (health, auth, workspaces, invites, API tokens, stub 404s).
---

# Testing the ir-logger backend

## Setup
- Node >= 22.12 required (`engines`). `better-sqlite3` must stay on 11.x — 13.x has been observed to segfault on Node 22.
- `npm install` at repo root. No build step, no secrets needed in development:
  `SESSION_SECRET` falls back to a **random per-boot** value whenever `NODE_ENV !== 'production'`.
  Consequence for testing: session cookies do NOT survive a server restart — after restarting,
  `/api/auth/session` returns `{"user":null,"workspaces":[]}` and guarded routes return 401 for an
  old cookie. That is expected; just log in again to get a fresh cookie. Never set
  `NODE_ENV=production` to work around it.
- Start: `nohup node src/server.js > /tmp/server.log 2>&1 &` (or `npm start`). Port = `PORT` or **3059**.
  It creates `./data/ir-logger.db` (WAL) and runs migrations at boot.
- For a clean run: `pkill -f "node src/server.js"; rm -rf data` before starting.
  **Never** point `DB_PATH` at anything but the local `./data` file; never set `NODE_ENV=production`.
- Gotcha: backgrounding the server inside a compound `cmd && (node ... &)` shell command can kill it
  when the tool call returns. Use a standalone `nohup ... &` call and verify with `curl /health`.

## Exercising the API
- Use one curl cookie jar per simulated user (`-b jar -c jar`); auth is `express-session` +
  passport local, cookie `connect.sid` (`HttpOnly; SameSite=Lax`, `Secure` only in production).
- `POST /api/auth/register {email,name,password}` logs you straight in (201). Password must be >= 10 chars.
- **Registration is rate-limited to 5 per hour per IP** (`src/routes/auth.js`), and every attempt counts,
  including ones that fail validation. Budget your registrations: a long test run that registers more
  than 5 users from localhost will start getting 429s partway through and look like a product bug.
- Useful routes: `GET /health`, `/api/auth/{session,login,logout,google}`,
  `POST|GET /api/workspaces`, `GET /api/workspaces/:id`,
  `POST /api/workspaces/:id/invite` → `inviteUrl` with raw token → `POST /api/invites/<token>/accept`,
  `POST|GET /api/workspaces/:id/tokens`, `DELETE /api/workspaces/:id/tokens/:tokenId`.
- `GET /api/workspaces/:id` returns top-level `{workspace, members}`; each member entry uses the key
  **`userId`** (not `id`) alongside `email`, `name`, `role` (SPEC §5.3). Assert the key name explicitly.
- Guard ordering on `POST .../invite`, `POST .../tokens`, `DELETE .../tokens/:id` is
  `requireUser` then `requireWorkspace({roles:['owner']})`, so the three-way distinction to assert is:
  unauthenticated → **401**, authenticated non-member (other tenant) → **404**,
  authenticated member with the wrong role → **403**.
- Non-member access to a workspace returns **404** (not 403) by design; wrong-role member returns 403.
- All Round-2 stub routers are empty; anything unmatched under `/api` returns JSON `{"error":"Not found"}` 404.
- `GET /api/auth/google` and `/api/auth/google/callback` both return 503 when
  `GOOGLE_CLIENT_ID/SECRET` are unset. To prove the strategy is still *wired* without any real
  credentials, boot a throwaway server with placeholder values
  (`PORT=3062 GOOGLE_CLIENT_ID=placeholder GOOGLE_CLIENT_SECRET=placeholder BASE_URL=http://localhost:3062`)
  and check `GET /api/auth/google` returns `302` to `accounts.google.com`. That builds the redirect
  locally and contacts nobody — do not attempt a real handshake.
- The Google account-resolution logic is exported as the pure function
  `resolveGoogleUser(db, profile)` from `src/auth/passport.js`, so it can be exercised directly
  against a migrated SQLite DB without OAuth. It denies (returns `false`) unless
  `profile.emails[0].verified === true` — strictly boolean, checked before any lookup/link/insert,
  and it consults only `emails[0]`. When testing it, snapshot the `users` table before/after each
  call and assert deny cases create and mutate nothing.
- Inspect state with `sqlite3 data/ir-logger.db`. The migrations bookkeeping table is
  **`schema_migrations`** (not `migrations`); seed migration 002 loads 50 `techniques` rows.
- Secrets are stored hashed: `invites.token_hash` / `api_tokens.token_hash` are sha256 hex,
  passwords are bcrypt. A test should assert raw tokens never appear in list responses.
- Audit rows are a hash chain. Verify it from outside the app with:
  `node -e "const{openDatabase}=require('./src/db');const a=require('./src/services/audit');
  console.log(a.verify(openDatabase('./data/ir-logger.db'),'<workspaceId>'))"` — expect
  `{valid:true,checked:N}`. Also assert that an operation writes exactly one audit row (e.g. one
  `token.deleted`) and that a failed operation writes none.

## Probing the rate limiter
- Limits live in `src/routes/auth.js`: registration **5 / 1h** (counts every attempt),
  login **10 failures / 15m** (counted only on failure, via `peek` + `recordFailure`).
  Over-limit responses are `429` with a `Retry-After` header.
- **Always probe limits on a throwaway server and DB**, e.g.
  `PORT=3061 DB_PATH=/tmp/rl/ir.db node src/server.js`, otherwise you saturate the shared
  localhost IP bucket and poison the rest of the run.
- `consume()` opportunistically purges stale windows, throttled to **once per 60s per process**
  (module-level `lastPurgeAt`). To test purge behaviour you must inject rows with an old
  `window_start` via `sqlite3`, wait >60s, then send one more request to trigger it.
- The purge is (and must stay) scoped to the caller's own `bucket_key`. A previous revision deleted
  `WHERE window_start < ?` across all buckets, which let a 15-minute login window wipe the live
  1-hour registration row and reset the cap — a real bypass. Regression test worth keeping:
  saturate registration → wait 60s → one failed login → the next registration must still be 429.
- Fail-closed check: `DROP TABLE rate_limits` under a running server; limited routes must return
  **503** `Rate limiter unavailable` (never allow the request through), while `/health` stays 200.

## Devin Secrets Needed
None for local backend testing. Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
would be needed only to test the real Google sign-in path; unconfigured it must 503, not crash.
