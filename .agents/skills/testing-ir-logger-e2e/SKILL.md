---
name: ir-logger end-to-end HTTP testing
description: How to run live-server end-to-end tests for the ir-logger Express API using cookie-jar HTTP clients and better-sqlite3 verification.
---

## When to use

Use this skill when a task asks you to verify ir-logger backend behavior against a real running server (not supertest/in-process). The app has no UI, so testing is HTTP-only.

## Environment setup

1. Use Node >=22.12 (see `package.json` `engines`).
2. Dependencies are installed with `npm install`; no build step is required.
3. Pick a temp `DB_PATH` and `EVIDENCE_DIR` and a free `PORT` (default `3059`).
4. Clean stale files between runs or the server may crash with `SQLITE_IOERR_SHORT_READ`:
   ```bash
   rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" "$DB_PATH-journal"
   rm -rf "$EVIDENCE_DIR"
   mkdir -p "$EVIDENCE_DIR"
   ```
5. Start the server:
   ```bash
   DB_PATH="$DB_PATH" EVIDENCE_DIR="$EVIDENCE_DIR" PORT="$PORT" SESSION_SECRET="<any-secret>" node src/server.js
   ```
6. Wait for `GET http://localhost:$PORT/health` to return `{"status":"ok"}` before issuing requests.

## Making requests

- The API is cookie-session based. Maintain a `connect.sid` cookie jar per actor (demo session, real user, second real user).
- Demo creation (`POST /api/demo`) requires a same-origin `Origin` header matching the `Host`, e.g. `Origin: http://localhost:3059` when calling `localhost:3059`.
- `Content-Type: application/json` is required for JSON bodies.

## Verifying state

- The server uses `better-sqlite3` in WAL mode. While the server is running, another process can open the same `DB_PATH` with `better-sqlite3` to read `incidents.created_by`, `entries.author_user_id`, `entry_techniques`, and `audit_log.actor_user_id`.
- Use `req.ip`-based rate limits in mind: multiple registrations or demo creations from the same IP can hit `registration` or `demo` buckets. A fresh DB resets the `rate_limits` table, but `req.ip` is still the loopback address.

## Common gotchas

- **Demo incident cap**: a demo workspace is seeded with one incident and allows a total of five. If you create an incident earlier in a flow for attribution checks, count remaining slots before the cap assertion.
- **Authenticated demo block**: `POST /api/demo` returns `409` with `Log out to start a demo session` when `req.user` exists. It does this before session regeneration or rate-limit consumption, so the authenticated session remains usable.
- **Demo actor cannot create workspaces, invite, or mint tokens**: these routes still use `requireUser` and return `401` for a demo-only session.

## Example verification script

A reusable Node runner is in this skill directory at `runner.js`. It starts the server, drives the API with `node:http`, and queries the database directly to confirm attribution and audit rows.

## Devin Secrets Needed

None for local testing; `SESSION_SECRET` can be any non-empty string. Google OAuth is disabled when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are unset.
