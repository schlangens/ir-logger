# Security narrative: how this system's security decisions were actually made

This is not a features list. It's the story of what happened to this codebase's
security-relevant decisions: which stance was written down before any code
existed, what the code did when it was actually attacked while running, what
broke, how it was fixed, and how each fix was pinned so it can't quietly break
again. Everything below is checkable — every commit hash and pull request
number links to a real, existing commit or PR in this repository, and every
code claim was re-read against the current source before being written here.

The full technical spec lives in [`SPEC.md`](SPEC.md); the rules given to the
coding agents that built this system live in [`AGENTS.md`](AGENTS.md). This
document is the guided tour through the security-relevant parts of both, plus
the parts that only live in the git history and the test suite.

**Where this project actually stands:** the backend is built and tested (164
Node tests + 9 Python tests, all passing as of this writing). There is no
browser interface yet and nothing is deployed anywhere — no live URL exists to
visit. Everything described below was exercised against a real running
instance of the server on a development machine, via its HTTP API, not against
a production deployment, because there isn't one.

---

## Who this system has to defend against

Four adversaries, each already assumed by the design (see `SPEC.md` §8, §9):

1. **An anonymous internet visitor**, hitting only the public, no-login demo
   endpoint. They can spin up a disposable, fully caged sandbox workspace (rate-
   and size-limited, auto-deleted after 24 hours) — nothing more. They cannot
   reach any real customer's data through it, cannot register that sandbox as
   a real login-capable account, and cannot use it to exceed the server's
   overall resource budget, because both the sandbox's own caps and a
   site-wide ceiling on how many sandboxes can exist at once are enforced
   before any row is written.
2. **An authenticated user who is a legitimate member of a different
   workspace ("tenant")** — a real customer, just not this one. Every
   workspace-scoped resource (an incident, a timeline entry, an evidence
   file) must refuse them identically to how it would refuse someone who
   isn't logged in at all: the same status code, and no leaked detail about
   whether the thing they asked for exists somewhere else. The design calls
   this the cross-tenant rule, and it applies even to routes that identify a
   resource by nothing but its own bare ID with no workspace mentioned in the
   URL — the shape of route most likely to be built wrong.
3. **Someone holding a stolen desktop-sync API token.** The token authenticates
   to exactly one workspace, is rate-limited both for guessing (a wrong token)
   and for use (a valid token used too fast), and — like every credential in
   this system — is never stored in a form that can be read back out; only its
   hash is kept.
4. **Someone with direct read/write access to the underlying database file** —
   a far stronger adversary than any of the above, e.g. someone with shell
   access to the box. This project is honest that this adversary largely wins:
   see "What this system does not claim" below.

## The spine: a stance was written down, the code was attacked, real defects
## were found, fixed, and pinned by tests proven to fail on regression

The build process for this system was: an explicit, dated security stance for
each area was written into `SPEC.md` and `AGENTS.md` before the corresponding
code existed. Coding agents then implemented against that stance. Before each
piece merged, and again later against the assembled, running server, the code
was attacked on purpose, not just read. Four real episodes carried that
process, in order.

### 1. A login rate limiter that a sequential test couldn't have caught

`SPEC.md` §5.2 requires the login endpoint to lock an attacker out after 10
failed attempts from one IP address in 15 minutes. The first implementation
checked the current failure count *before* deciding whether to allow the
request through, and only recorded the new failure *after* the login attempt
had already been processed. Driven one request at a time, that looks correct
— and the original test proved it, literally in a loop:

```js
for (let i = 0; i < 10; i++) {
  const response = await request(app).post("/api/auth/login")...
  assert.equal(response.status, 401);
}
```

Each loop iteration waits for the previous one to finish, so each failure is
safely recorded before the next check happens. But nothing about the real
`/api/auth/login` endpoint enforces "one request at a time" — an attacker can
fire many login attempts at once. Under concurrency, every one of those
simultaneous requests reads the *same* stale "count so far" before any of them
has recorded its own failure, so far more than 10 wrong-password attempts can
land in the same window. The sequential test was structurally incapable of
seeing this, because the very thing that causes the bug — several requests in
flight at the same instant — never happens when each request is awaited before
the next begins.

This was one of several defects found and fixed during an adversarial review
pass on the very first pull request (commit
[`ab59e6d`](https://github.com/schlangens/ir-logger/commit/ab59e6daa718371a35184091dad818b894539bc1),
"Fix adversarial-review security defects in the Round 1 foundation," part of
[PR #2](https://github.com/schlangens/ir-logger/pull/2)). The fix flipped the
order: every attempt is now counted *before* the login check runs, and a
successful login refunds one count back, rather than a failed login adding
one count after the fact. That closes the race, because the counter moves
before the outcome is known, not after.

But the first version of that refund was itself a new hole. It deleted the
entire counter row for that IP address on a successful login
(`DELETE FROM rate_limits WHERE bucket_key=... AND window_start=...`). The
counter bucket is keyed by IP address, not by which account logged in — so an
attacker sharing that IP with (or simply owning) any account that can log in
successfully could brute-force a *different* account's password from the same
IP, then log into their own account once to reset the whole IP's budget back
to zero, and keep going indefinitely. The next commit
([`0d419ee`](https://github.com/schlangens/ir-logger/commit/0d419ee6802e74332324e6cfe49e11b1c001bad1))
replaced the delete with a floored decrement — `UPDATE rate_limits SET
count=count-1 WHERE ... AND count>0` — so a success only ever gives back the
one attempt it itself consumed, never the whole bucket. A follow-up commit
([`7d1b057`](https://github.com/schlangens/ir-logger/commit/7d1b057e27135a30c4ed8c0baa252266351c61cf))
hardened the floor further, from a `WHERE count>0` guard to `SET
count=MAX(count-1, 0)`, closing a narrower race in the same spot. All three
fixes landed before that first PR ever reached `main`.

The property is now pinned by tests that were confirmed to fail on the broken
code and pass on the fixed code: `tests/foundation/security-round1.test.js`
fires 25 concurrent bad-password attempts and asserts a `429` shows up among
them (the concurrency case the sequential loop couldn't see), and a separate
test proves a successful login only ever refunds its own single attempt, even
when interleaved with another account's failed attempts from the same shared
IP.

### 2. A tamper-evident audit log that produced a false tamper alarm

`SPEC.md` §2.7 hash-chains every row of the audit log so that any edit to a
past row can be detected — each row's hash is computed from its own fields
plus the previous row's hash, and `verify()` walks the chain recomputing and
comparing. The honest caveat, stated directly in the spec, is that this only
protects against tampering through the application's normal write paths; it
cannot stop someone who already has direct write access to the database file
and is willing to recompute the whole chain forward after editing a row (see
"What this system does not claim," below).

But the first implementation had a bug that was arguably worse for a
tamper-evidence claim than a missed detection would have been: it could
report tampering that never happened. If a numeric value (for example, a
technique or entry ID passed as a number rather than a string) was hashed at
write time as a JavaScript number, but then read back from SQLite — where the
column is declared `TEXT` — as a string, the two representations serialize
differently in the canonical JSON the hash is built from. `verify()` would
then recompute a hash that didn't match the one stored at write time, and
report the chain as broken, even though nothing had actually been altered. A
missed detection is a known, bounded gap; a false positive erodes the whole
claim, because now every "the chain is broken" result has to be second-guessed
instead of trusted.

This was fixed in the same adversarial-review pass
([`ab59e6d`](https://github.com/schlangens/ir-logger/commit/ab59e6daa718371a35184091dad818b894539bc1)):
every field going into the hash is explicitly coerced with `String(...)`
before hashing, so the value that gets hashed at append time is byte-identical
to what SQLite will hand back at verify time, regardless of what type the
caller originally passed. It's pinned by a test in
`tests/foundation/security-round1.test.js` that appends an audit row with a
numeric workspace ID, actor ID, action, and target ID, then calls `verify()`
and asserts the chain reads back as intact — proving the false-alarm case
specifically, not just that hashing works at all.

### 3. A safety property that was true only by accident, and a test that was deliberately not written

On 2026-08-12, this repository underwent a hands-on attack pass against a
running instance of the assembled server — driving real HTTP requests at it,
not reading the code and assuming — while five pull requests were still open
and in flight for other parts of the build. One of the properties checked was
whether the synthetic, passwordless "Demo visitor" account that every instant
sandbox creates (`SPEC.md` §9) could somehow be turned into a way to log in as
a real, persistent user.

The local-password path was fine: that account has no `password_hash` and
`passport`'s local strategy still runs a constant-time comparison against a
fixed dummy hash before rejecting it, so there's no shortcut and no timing
tell. But the Google sign-in path was a genuine gap. `resolveGoogleUser()`
would link *any* existing user row — including a demo row with no `google_id`
— to whatever Google account presented a `verified: true` email matching that
row's stored email address. Called directly against a freshly seeded database
with a forged-but-plausible verified profile, it returned the demo user
instead of refusing it, and would have written a real `google_id` onto that
synthetic row.

In practice, this was not exploitable on 2026-08-12: every demo user's email
address is generated under the `@demo.invalid` domain, and `.invalid` is a
domain suffix reserved by internet standards to never resolve — no mail server
answers for it, so Google itself can never issue a `verified: true` assertion
for an address in that domain. The safety here lived entirely outside the
application's own code, in a property of the domain name, not in anything
`resolveGoogleUser()` checked.

The honest move — and the one actually taken — was not to write a test
asserting the fix while the code still had the gap. Doing so would have been a
false assertion against the code as it stood that day. Instead, the gap was
documented in detail directly next to the pinned local-login test in
`tests/foundation/security-live-audit.test.js`, in commit
[`c3716c2`](https://github.com/schlangens/ir-logger/commit/c3716c2e365dd5c9109f30c8bcd6c6f8572aadc7)
("Pin six properties a live attack audit verified by hand but no test
covered"), naming the exact unmerged branch already fixing it. That branch
merged shortly after as
[PR #10](https://github.com/schlangens/ir-logger/pull/10) (commit
[`58442b6`](https://github.com/schlangens/ir-logger/commit/58442b630fb4b61d7d844cb76959d2fb35eb4d49),
merged as [`0ae4585`](https://github.com/schlangens/ir-logger/commit/0ae4585f76cb5bee548241bcaf0c21150ca08fe7)):
`resolveGoogleUser()` now explicitly checks `is_demo === 1` on both the
existing-linked-account path and the link-by-matching-email path, and refuses
either with a plain `false`, regardless of what the calling Google profile
claims. The gap is closed in the application's own code now, not left
resting on a coincidence of domain-name reservation.

### 4. An investigation that disproved a claim instead of confirming one

`SPEC.md` §8.8 covers how the server figures out a request's real IP address
for rate limiting — the setting is `trust proxy: 1`, meaning Express trusts
exactly one hop of the `X-Forwarded-For` header, matching the real network
path of one nginx reverse proxy in front of the app. An earlier draft of the
spec claimed that the nginx site *must* overwrite that header rather than
append the real address onto whatever the client sent, because an appending
config would supposedly let a client forge an IP by prepending a fake one —
which is a commonly repeated claim about proxy configuration.

That claim was checked by tracing the actual library Express uses
(`proxy-addr`) rather than trusted at face value, and it turned out to be
wrong for this specific setting. At `trust proxy: 1`, that library builds its
candidate address list as the real socket address followed by the header's
entries read left to right, trusts only the first entry in that list (the
real socket address), and returns the second — which, under an *appending*
config, is always the right-most header entry, exactly the one nginx itself
just set. A client's forged, prepended entry lands further left in the list
and is never the one returned. This was verified directly, not just reasoned
about: by tracing the installed `proxy-addr` source and reproducing it against
forged single entries, multi-entry forged chains, and malformed headers, every
case still yielded the real peer address.

Commit
[`076caf9`](https://github.com/schlangens/ir-logger/commit/076caf96e0ad2e8126f1d433191ccdfe3ea0fc78)
("Correct the X-Forwarded-For rationale in the spec") rewrote §8.8 to say
this plainly, rather than let a wrong justification for a correct-looking
config stand uncorrected. The nginx overwrite directive is still kept — but
now correctly labeled as *hardening*, not a fix for a live hole: its actual
value is that it removes any attacker-supplied prefix from the header
entirely, so a later, unrelated mistake (someone raising `trust proxy` above
the real hop count, or setting it to `true`) can't turn the header into an
attacker-controlled value. That second setting — `trust proxy` itself — is
the one flagged as the actually security-relevant one, and `AGENTS.md` §3
tells every future agent never to touch it without also changing the real
hop count to match.

---

## Two smaller pieces of the same discipline

- **A follow-up hardening pass** (commit
  [`510e7e3`](https://github.com/schlangens/ir-logger/commit/510e7e35d7d6a26c5cdfe906fe07f1f10e1d6203),
  [PR #11](https://github.com/schlangens/ir-logger/pull/11)) added rate limits
  to three endpoints that the live attack pass found unprotected — the
  technique list, the ATT&CK coverage matrix, and evidence uploads — and
  normalized a subtle inconsistency: a couple of routes were returning the
  workspace guard's raw `403`/error body for a cross-tenant resource instead
  of the flat, identical-to-not-found `404` the rest of the system uses,
  which is exactly the kind of small inconsistency that can tell an attacker
  "this ID exists, you're just not allowed to see it" instead of "this ID
  doesn't exist."
- **Cookie/CSRF reasoning** (`AGENTS.md` §3): the session cookie uses
  `sameSite: 'lax'`, not `'strict'`, because `'strict'` would silently break
  Google sign-in — Google's OAuth redirect back to this app is a cross-site,
  top-level navigation, and a `'strict'` cookie is withheld on exactly that
  request. `'lax'` is still adequate CSRF protection here specifically
  because every state-changing request this app makes (`POST`/`PATCH`/`DELETE`)
  is issued by this app's own frontend script, never by a plain cross-site
  HTML form, image tag, or similar — the class of request `'lax'` doesn't
  protect against never occurs in this app's own design. The one
  unauthenticated endpoint that creates state without a session,
  `POST /api/demo`, additionally checks the request's `Origin` header
  itself, which is why the live-audit tests had to be updated (commit
  [`096722e`](https://github.com/schlangens/ir-logger/commit/096722e43e5de64e98ef9068e251a3aead9b3fa0))
  to send one — the test client doesn't send `Origin` by default the way a
  real browser does, and the endpoint correctly refuses the request when it's
  missing.
- **The bare-ID rule** (`AGENTS.md` §4): any route that looks up a single
  resource by its own ID with no workspace or parent segment in the URL —
  the exact shape of route most likely to hide a cross-tenant bug, because
  nothing in the URL hints that a resolution step is even needed — is
  required to ship with an explicit test proving that a resource belonging to
  a workspace the caller isn't a member of comes back as a plain `404`, not a
  `403` or, worse, the data itself.

## What this system does not claim

- The audit log's hash chain, honestly stated in `SPEC.md` §2.7, protects
  against tampering through the application's own code paths — a compromised
  session, a bug in a write path, a bad migration. It does **not** protect
  against someone who already has direct write access to the underlying
  SQLite file and is willing to take the extra step of recomputing every
  subsequent hash after editing a row; with the hashing algorithm fully
  published (as it is, in `SPEC.md`), that person can make `verify()` report
  the chain as intact even after editing it. Closing that gap requires
  anchoring the chain somewhere that same privileged actor can't also
  rewrite — signing it periodically with a key stored outside the database,
  writing to write-once storage, or forwarding it to an independent external
  log. All three are explicitly out of scope for this build. The stated
  guarantee is "tamper-evident against everything except a privileged actor
  who also updates the chain," never "tamper-proof."
- Nothing is deployed. There is no live server anyone can visit, and there is
  no browser interface yet — only the HTTP API and its test suite exist
  today.
- The demo sandbox is a real, running-server threat model that was tested
  live during development, but it has never been exposed on the public
  internet; the attacks described above were run against a local development
  instance.

## How this was built

This system was built by several coding agents working from the same written
specification, each one's output reviewed and — as the episodes above show —
actually attacked before it was allowed to merge, sometimes by another agent
session, sometimes directly by the project's owner. That's the reason this
repository has an explicit file-ownership convention (each agent session owns
a fixed set of files, spelled out in `AGENTS.md` §7 and `docs/devin-briefs/`)
and a standing rule that no agent merges its own work: the review-and-attack
step is not incidental to the process, it's the point of splitting the work
this way. Every fix described above exists because something written by one
pass was deliberately broken by another pass before it was trusted.
