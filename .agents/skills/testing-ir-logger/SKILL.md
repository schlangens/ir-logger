---
name: Testing ir-logger
description: How to start the ir-logger backend and run end-to-end API tests for evidence upload, download, and cap behavior.
---

# Testing ir-logger

## What this app is

`ir-logger` is a Node/Express + better-sqlite3 incident-response logger. There is no build step and the current checkout has no `public/` frontend, so end-to-end testing of backend routes is done against a running HTTP API.

## Starting the server for tests

The server boots from `src/server.js` and runs migrations before listening:

```bash
cd /home/ubuntu/repos/ir-logger
DB_PATH=/tmp/ir-logger-test.db \
EVIDENCE_DIR=/tmp/ir-logger-evidence \
PORT=3059 \
SESSION_SECRET=<any-secret> \
node src/server.js
```

- `PORT` defaults to `3059`.
- `DB_PATH` defaults to `./data/ir-logger.db`.
- `EVIDENCE_DIR` defaults to `./data/evidence`.
- Use isolated temp paths so manual tests do not clobber the repo `data/` directory.

## Dependencies / environment

- Node >= 22.12 (required for `require(esm)` used by `nanoid`).
- `npm install` already handles all deps; there is no build step.
- No secrets are required for local auth testing.

## Authentication for API tests

Local registration works without OAuth:

```bash
curl -c cookies.txt -b cookies.txt -X POST http://localhost:3059/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","name":"Tester","password":"longpassword123"}'
```

A demo workspace can be created without a user account, but `POST /api/demo` requires same-origin `Origin`/`Referer` headers:

```bash
curl -c demo-cookies.txt -b demo-cookies.txt -X POST http://localhost:3059/api/demo \
  -H 'Origin: http://localhost:3059' \
  -H 'Referer: http://localhost:3059/'
```

## Common end-to-end patterns

### Create a workspace and incident

```bash
# create workspace
curl -c cookies.txt -b cookies.txt -X POST http://localhost:3059/api/workspaces \
  -H 'Content-Type: application/json' -d '{"name":"Test Workspace"}'

# create incident (severity must be low|medium|high|critical)
curl -c cookies.txt -b cookies.txt -X POST http://localhost:3059/api/workspaces/<workspaceId>/incidents \
  -H 'Content-Type: application/json' \
  -d '{"title":"Incident","summary":"test","severity":"high"}'
```

### Upload evidence

```bash
curl -c cookies.txt -b cookies.txt -X POST http://localhost:3059/api/incidents/<incidentId>/evidence \
  -F 'file=@/path/to/file.bin'
```

### Download evidence

```bash
curl -c cookies.txt -b cookies.txt -OJ http://localhost:3059/api/evidence/<evidenceId>/download
```

Response headers must be:

- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="<sanitized-filename>"`

### Useful file caps

- Normal workspace: 25 MB per file, 200 MB total.
- Demo workspace: 5 MB per file, 20 MB total, 5 evidence rows.

## Test commands

```bash
npm test               # node --test "tests/**/*.test.js"
```

## Devin Secrets Needed

None for local/API testing. OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are only needed for Google sign-in tests.

## Notes / gotchas

- The repo checkout in this environment had no `public/` directory, so browser-driven UI testing is not possible without building or pulling a frontend.
- If a previous server process is still running, reusing `DB_PATH` can produce `SQLITE_IOERR_SHORT_READ`; kill old Node processes and delete the `.db`, `.db-wal`, and `.db-shm` files before restarting.
- better-sqlite3 11.x is pinned; 13.x segfaults on Node 22.12.
