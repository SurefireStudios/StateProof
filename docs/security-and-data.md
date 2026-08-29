# Security and data handling

## Data

- **Everything is synthetic.** Every fixture, name, email address, order and
  refund in this repository is invented. There is no real customer data, no real
  transaction and no scraped content.
- **All writes stay in the sandbox.** Replay applies tool effects to an in-memory
  state clone, transactionally. Nothing in this project can reach an external
  system.
- **Human approval is modelled as a scoped trace event**, ordered by `seq`, so
  "approved before the protected action" is a checkable fact rather than a claim
  in an argument.
- **Evidence sources are read-only by construction.** The tool registry marks
  them, and the verification path never invokes a write-capable tool.

## Credentials

- StateProof reads **`STATEPROOF_ANTHROPIC_API_KEY`** and deliberately **never**
  reads `ANTHROPIC_API_KEY`. That variable belongs to whatever tooling the
  developer is already running, and quietly borrowing it would make it
  impossible to say which credential paid for a run.
- The key is read from the environment at client construction. It is **never**
  written into a prompt, an artifact, a manifest, a report, a log line or a
  rendered page.
- `.env` is git-ignored. `.env.example` is tracked and contains no values; a test
  asserts that every `KEY=` line in it is empty.
- Stray copies are ignored too (`.env.*`, `.env*Copy*`, `*.env`), because a
  Windows "Copy" duplicate of a real `.env` is an easy way to commit a key.
- A run with no credential **fails and writes nothing**. Tests run the real CLIs
  in a child process with a scrubbed environment and a scratch working directory,
  then assert the artifacts directory is still empty.
- The dashboard build and `pnpm reproduce` require no credential at all, and a
  test asserts the built site contains no credential-shaped string and no `.env`
  file.

## Reproducibility guarantees

- A live run refuses to start unless the tracked working tree matches HEAD, and
  the manifest records the commit, `sourceTreeClean`, the prompt hash and the
  assertion schema version.
- `pnpm check:provenance <runId>` re-derives the prompt hash from the commit the
  manifest names. It fails on the one historical run that predates its own
  commit — documented in `docs/limitations.md` rather than quietly repaired.
- The pinned registry (`submission/reproduction-manifest.json`) records a
  canonical prediction hash per run and a contract hash per compiled contract.
  Editing any pinned artifact makes both the dashboard build and
  `pnpm reproduce` fail loudly.

## Locked-split protection

The four locked challenge cases in each suite are gated at three levels: the CLI
refuses `--split locked` without an explicit environment override, the pinned
registry schema rejects a locked id in the replay set, and `pnpm reproduce`
asserts that no locked case reaches the prediction phase. Locked fixtures *are*
read during scoring to compute the gold-inclusive dataset hash, which is
deliberate and distinct from evaluating them.

## The product surface

`apps/product` is read-only by construction: it verifies, it never writes to a
sandbox, and no route performs a consequential action.

- **Uploads are treated as hostile.** Archives are read by a hand-written reader
  that rejects traversal names, absolute paths, null bytes, unsupported
  compression methods, more than 64 entries, entries over 8 MB and expansions
  over 32 MB. Bodies are capped at 12 MB. Every payload is parsed through Zod in
  both directions.
- **Rendering is structural.** The client builds DOM nodes and sets text through
  `textContent`; `innerHTML`, `outerHTML` and `insertAdjacentHTML` appear nowhere
  in it, and a test enforces that. An imported task instruction or agent response
  cannot become markup.
- **Headers.** Every product response carries
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  plus `nosniff` and `no-referrer`. The client sets no `style` attributes,
  because that policy blocks them — a test fails the build if one reappears.
- **One deliberate exception.** The static evidence dashboard is a separate
  application hosted at `/dashboard/`, and its generator writes `style`
  attributes. That path alone is served with `style-src 'self' 'unsafe-inline'`.
  Scripts remain same-origin, and the dashboard renders committed artifacts only
  — no request data reaches it — so the allowance carries no injection surface.
  The product's own routes keep the strict policy.
- **Nothing persists.** Imports and runs live in memory behind a TTL. Restarting
  the server loses them, by design.
- **Contract compilation is off by default**, requires a key on the server, runs
  only on an explicit click, is rate-limited to three per minute, and writes to a
  temporary directory it deletes before responding.

## The sample run package

`samples/stateproof-sample-run.zip` is built through `loadAgentVisibleCase`, the
gold-isolated loader, so it can only contain the six files an agent could itself
have seen. It carries no gold contract, gold verdict, case metadata, split label,
credential or local path, and three tests check the archive's contents
independently of how it was produced.

## Secret scanning

`pnpm scan:secrets` runs over tracked files and built output, and over an
extracted release package when given a directory. It looks for Anthropic keys,
either credential variable carrying a value, generic `api_key`/`secret_key`/
`access_token`/`auth_token`/`client_secret` assignments, bearer-token literals,
private-key blocks, absolute Windows and POSIX user paths, and email addresses
outside the reserved `example.*` fixture domains. It refuses `.env` and anything
that looks like a copy of one, plus key material by extension, **by name** —
those files are never opened. It also opens `.zip` archives and scans each entry,
so a secret cannot hide inside the sample package or the release archive.

`.env.example` is the one permitted member of the environment-file family and is
checked separately for carrying a value rather than a blank placeholder.

## What is not addressed

No authentication, authorization, rate limiting, tenancy isolation, audit
logging, key rotation or secret management. This is an evaluation harness with a
static report viewer, not a deployed service.
