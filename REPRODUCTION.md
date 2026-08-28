# Reproduction

Everything below runs offline. No API key is required, read, or accepted at
this stage of the project.

## Requirements

- Node.js `>=20.10.0` (built and verified on 20.10.0)
- pnpm `>=8.12.0` (built and verified on 8.12.0)

## Working commands

```bash
pnpm install
```

```bash
pnpm typecheck
```

Strict TypeScript across `packages/core` and `packages/benchmark`, including
test files. Exits non-zero on any type error.

```bash
pnpm test
```

Runs the whole Vitest suite: schema validation, the assertion vocabulary,
state diffing, verdict roll-up, canonical serialization, sample-case
semantics, gold isolation, and deterministic loading.

```bash
pnpm benchmark:validate
```

Loads every case in `benchmarks/phantombench-12/cases`, validates each fixture
file against its schema, checks structural consistency, replays the gold
contract through the deterministic verifier, and compares the result with the
gold verdict and case metadata. Prints a dataset hash and a per-requirement
breakdown, and exits non-zero on any error.

Expected output for the current dataset ends with:

```text
12 case(s) validated, 0 error(s)
RESULT: PASSED
```

The dataset hash is derived from fixture content. It changes whenever a
fixture changes, which is the point: any future metric can be tied back to the
exact dataset that produced it.

```bash
pnpm fixtures:generate
```

Regenerates the eleven generated fixtures from `scripts/fixtures/` and rewrites
the split manifests. `PB-A03` is frozen and is never rewritten. Running it on an
unchanged tree is a no-op in content terms; `pnpm benchmark:validate` then
re-derives every final state independently.

## Requires model credentials

Credentials go in a git-ignored `.env` at the repository root:

```text
STATEPROOF_ANTHROPIC_API_KEY=...
```

**Deliberately not `ANTHROPIC_API_KEY`.** That variable belongs to a Claude
Code session's own authentication; StateProof never reads it, and never writes
to it.

```bash
pnpm benchmark:smoke-model
```

One tiny structured request against the configured provider and model. It
reads no benchmark case and writes nothing, so an invalid API configuration
surfaces in seconds instead of eight cases into a real run.

```bash
pnpm benchmark:baseline -- --split development
```

Runs the fair baseline over the eight development cases, writes prediction
artifacts, then scores them against gold in a separate phase.

**Neither command has been run.** No credentials are configured in this
environment, so both exit with status 2 and this message, having written
nothing:

```text
No model credentials are configured, so no live run can be made.

Set STATEPROOF_ANTHROPIC_API_KEY in a local .env at the repository root (see
.env.example). .env is git-ignored and is loaded automatically.

StateProof deliberately does not read ANTHROPIC_API_KEY: that variable
belongs to your Claude Code session's own authentication.

Nothing has been written. A baseline run is never simulated: a report with
no real model behind it would be worse than no report.
```

To run them: put `STATEPROOF_ANTHROPIC_API_KEY` in `.env` and re-run. Provider
`anthropic`, model `claude-opus-5`, effort `high`, max tokens 16000, 120s
timeout, one schema repair retry. `STATEPROOF_MODEL_ID`,
`STATEPROOF_MODEL_EFFORT`, `STATEPROOF_MODEL_MAX_TOKENS` and
`STATEPROOF_MODEL_TIMEOUT_MS` override those defaults and are recorded at their
actual values in the run manifest. Expect eight model calls plus at most one repair each; runtime is
dominated by the provider and the payloads are large (full trajectory plus both
state snapshots per case). Cost is recorded from real usage in the run
manifest; nothing is estimated in advance.

Artifacts land under `artifacts/`:

| Path | Contents |
| --- | --- |
| `artifacts/model-responses/<runId>/` | Every attempt: prompt, raw response, usage, validation error |
| `artifacts/predictions/<runId>.json` | Prediction-phase output, written before any gold file is read |
| `artifacts/run-manifests/<runId>.json` | Model, config, prompt hashes, dataset hash, commit SHA, timing, usage |
| `artifacts/reports/<runId>.{json,md}` | Metrics, confusion matrix, per-case results |

The locked split is refused unless `STATEPROOF_ALLOW_LOCKED_RUN=1` is set. Do
not set it before the freeze point described in `docs/evaluation-plan.md`.

## Not implemented yet

These are part of the intended final command contract and are **deliberately
absent** rather than stubbed, so that no command can report a success it did
not achieve:

| Command                     | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `pnpm benchmark:stateproof` | Run Contract Agent → Evidence Agent → verifier.     |
| `pnpm benchmark:report`     | Generate metrics and the human-readable report.     |
| `pnpm reproduce`            | Re-score from committed captured responses, no key. |
| `pnpm run:live`             | Live provider run; will document variability, runtime and cost. |
| `pnpm dev`                  | Judge-facing web app.                               |

Running any of them today fails with an "unknown script" error from pnpm. That
is the intended behaviour for now.

When `pnpm run:live` exists it will document, in this file: the required
environment variable, the provider and model id, approximate runtime,
approximate cost, and expected run-to-run variability. `pnpm reproduce` will
work from committed captured responses with no key at all, and is the
canonical reproducible artifact.

## Determinism

Fixture loading, canonical serialization, hashing, and the deterministic
verifier contain no timestamps, no randomness, and no clock reads. Verifier
output is a pure function of the fixture — `pnpm benchmark:validate` re-runs
the verification internally and fails the case if the two runs differ.

Running `pnpm benchmark:validate` twice on an unchanged working tree produces
byte-identical output apart from the reported wall-clock duration.
