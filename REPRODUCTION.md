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
1 case(s) validated, 0 error(s)
RESULT: PASSED
```

The dataset hash is derived from fixture content. It changes whenever a
fixture changes, which is the point: any future metric can be tied back to the
exact dataset that produced it.

## Not implemented yet

These are part of the intended final command contract and are **deliberately
absent** rather than stubbed, so that no command can report a success it did
not achieve:

| Command                     | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `pnpm benchmark:baseline`   | Run the single general-purpose evaluator baseline.  |
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
