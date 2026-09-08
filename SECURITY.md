# Security policy

StateProof is an evaluation harness and a read-only verification product. It
performs no consequential action, holds no customer data, and ships with no
credential. Even so, it accepts untrusted input (uploaded run packages) and
serves a public deployment, so it has a security surface worth reporting
against.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private vulnerability reporting for this repository:

**<https://github.com/SurefireStudios/StateProof/security/advisories/new>**

Include what you found, how to reproduce it, and what you believe the impact
is. You will get an acknowledgement within five working days. If the report is
confirmed, a fix is prepared privately, released, and credited to you in the
advisory unless you prefer otherwise.

## Scope

In scope:

- The product server under `apps/product/src/server/` — request handling,
  archive parsing (`zip.ts`), import validation, rate limiting, headers.
- The product client under `apps/product/src/client/` — rendering of imported
  or user-supplied content.
- The credential handling in `packages/model-provider/`.
- The secret scanner (`scripts/scan-secrets.ts`) missing something it claims to
  catch.
- Anything that would let the verifier or the product write outside a
  temporary directory, reach a network service it should not, or read
  `ANTHROPIC_API_KEY`.

Out of scope:

- The synthetic benchmark data being "wrong" about a fictional refund. Open a
  normal issue.
- Denial of service against the public demo beyond what the documented
  limits (body size, entry counts, per-IP rate limit) are meant to hold.
- Vulnerabilities in third-party dependencies with no reachable path from this
  code. Dependabot tracks those; a pull request is welcome.

## What is already in place

Documented in full in [docs/security-and-data.md](docs/security-and-data.md).
In brief:

- Uploads are treated as hostile: a hand-written zip reader rejects traversal
  names, absolute paths, null bytes, unsupported compression, more than 64
  entries, entries over 8 MB and expansions over 32 MB. Bodies are capped.
- Every payload is parsed through Zod in both directions.
- The client renders structurally and never uses `innerHTML`; a test enforces
  it. Responses carry a strict Content-Security-Policy, `nosniff` and
  `no-referrer`.
- Nothing persists. Imports and runs live in memory behind a TTL.
- The only credential variable ever read is `STATEPROOF_ANTHROPIC_API_KEY`, and
  only when live compilation is explicitly enabled. `ANTHROPIC_API_KEY` is never
  read, and a test asserts it.
- `pnpm scan:secrets` runs over tracked files, built output and release
  archives, and runs in CI.

## Supported versions

Security fixes are applied to the `main` branch and to the most recent tagged
release. Older tags are historical records of the evaluation and are not
patched.
