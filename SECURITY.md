# Reporting a security issue

If you find a vulnerability in this project, please report it privately
rather than opening a public issue.

**How:** use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or email scott@scottschlangen.com.

**What to include:** what you found, how to reproduce it, and what an
attacker gains. A working reproduction is more useful than a description.

**What to expect:** an acknowledgement within a few days. This is a personal
project maintained in spare time, so there is no paid bounty and no
guaranteed fix timeline — but a real finding will be credited in the fix
commit unless you would rather not be.

## Scope

In scope: the web application in `src/` and `public/`, the desktop tool
`ir-logger.py`, and the deployment at https://ir.scottslab.io.

The public demo sandbox at that address is deliberately open, no-signup, and
disposable. Testing against it is welcome within reason — please do not run
volumetric or denial-of-service testing against it, since it shares a host
with unrelated services.

Out of scope: the host's other services and unrelated subdomains.

## What this project already tells you it does not defend against

`SECURITY-NARRATIVE.md` documents the known limits rather than hiding them —
most notably that the hash-chained audit log is tamper-*evident*, not
tamper-proof, and does not survive a privileged actor with direct database
write access who also recomputes the chain. Findings that restate a
documented limit are not vulnerabilities, but findings that show a limit is
worse than documented very much are.
