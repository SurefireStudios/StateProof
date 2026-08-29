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

## What is not addressed

No authentication, authorization, rate limiting, tenancy isolation, audit
logging, key rotation or secret management. This is an evaluation harness with a
static report viewer, not a deployed service.
