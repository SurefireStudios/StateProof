# Reproduction

Everything in this document runs **without an API credential**. Neither
`STATEPROOF_ANTHROPIC_API_KEY` nor `ANTHROPIC_API_KEY` is read, required, or
accepted by any command below.

## Requirements

- Node.js `>=20.10.0`
- pnpm `>=8.12.0`

## The one command

```bash
pnpm install
pnpm reproduce
```

`pnpm reproduce` performs twenty-six checks and prints `RESULT: PASSED` only if
all of them hold:

1. Core-12 fixtures validate (schema + semantic + gold consistency).
2. Hard-12 fixtures validate.
3. The pinned registry `submission/reproduction-manifest.json` parses and every
   referenced file exists.
4. Every pinned prompt hash, contract hash and canonical prediction hash is
   re-derived and compared.
5. No locked case is registered or replayed.
6. The committed v3 contract bundle loads with full integrity verification.
7. All twelve Hard cases — eight development and four locked — are re-verified
   from that bundle.
8. Zero model calls; `modelUsage` is null.
9. Zero model tokens.
10. No raw model-response file is written.
11. All eight cases report `cacheHit: true`.
12. Canonical predictions are byte-identical to the pinned warm run.
13. Contract hashes match the pinned run, case by case.
14. SVR, FVR, CDR and BVA match the pinned report exactly.
15. Every evidence reference resolves (80/80).
16. No locked case reaches the *development* prediction phase, and the
    development scoring covers exactly the eight development cases.
17. The locked replay makes zero calls, reuses the frozen contracts, and matches
    the submitted locked predictions byte for byte.
18. Development, locked and combined metrics are recomputed — the combined view
    from counts, never by averaging percentages.
19. The frozen baseline artifacts still agree with their own reports.
20. Nothing under `artifacts/` is modified: the replay writes only to a scratch
    directory.

Expected tail:

```text
  cases              8 hard-development + 4 hard-locked
  model calls        0 (baseline needed 8)
  model tokens       0 (baseline needed 84616)
  SVR / FVR / CDR    100.0% / 0.0% / 100.0%
  BVA                100.0%

RESULT: PASSED (27 checks)
```

Expected runtime: under a minute on a warm `node_modules`, dominated by fixture
validation. The deterministic verification itself is roughly 80 ms for the
development split and 130 ms for all twelve.

It fails on a tampered contract, a missing artifact, a hash mismatch, a changed
prediction, an unresolved evidence reference or any locked-case access.

## Faster variant

```bash
pnpm reproduce:check
```

Validates the benchmarks, the registry, every artifact hash and run provenance,
without re-running verification.

## Everything else that runs offline

```bash
pnpm typecheck
pnpm test
pnpm benchmark:validate
pnpm benchmark:validate-hard
pnpm dashboard:build
pnpm dev                      # http://localhost:4173/
pnpm compare:development "Frontier baseline=RUN-baseline-hard-development-live-20260828T233139Z" \
                         "StateProof v3 cold=RUN-stateproof-hard-development-cold-20260829T022133Z" \
                         "StateProof v3 warm=RUN-stateproof-hard-development-warm-20260829T022344Z"
pnpm check:provenance RUN-stateproof-hard-development-cold-20260829T022133Z
```

`pnpm check:provenance` re-derives a run's prompt hash from the commit its
manifest records. It passes on the v2 and v3 runs and **fails on the Gate 3A
run**, which is the documented provenance defect described in
[`docs/limitations.md`](docs/limitations.md).

## Commands that do require a credential

These are how the recorded results were produced. Nothing in this repository
needs them re-run.

```bash
pnpm benchmark:smoke-model
pnpm benchmark:baseline
pnpm benchmark:baseline-hard
pnpm benchmark:stateproof-hard -- --split development \
  --prompt prompts/contract-agent/v3.md \
  --baseline-run RUN-baseline-hard-development-live-20260828T233139Z
```

They read `STATEPROOF_ANTHROPIC_API_KEY` from `.env` — deliberately **not**
`ANTHROPIC_API_KEY`, which belongs to your own tooling and is never read. A live
cold run also refuses to start unless the tracked working tree matches HEAD, so
every result stays re-derivable from a commit.

Expected variability: a live run calls a frontier model, so token counts and
wall-clock time vary between runs, and a differently-worded contract is possible.
The warm path has no such variability — it is deterministic by construction, and
the repeat check in `pnpm reproduce` is what demonstrates that.

## Clean-checkout verification

```bash
pnpm test:clean-reproduction
```

Clones HEAD into a temporary directory containing no `.env`, no `node_modules`
and no build output, removes both credential variables from the child
environment, and runs `pnpm install --frozen-lockfile`, `typecheck`, `test`,
both validators, `reproduce` and `dashboard:build` there. It also greps the
generated site for absolute paths pointing back at the development machine.
Results are written to
[`submission/clean-reproduction-report.md`](submission/clean-reproduction-report.md).

## The locked evaluation

The four held-out cases were run **once**, after the source freeze at
`c976e3838477afbf951d0faf57011be1b4ef6864` (tag
`stateproof-evaluation-freeze-v1`). Both locked CLIs require `--split locked`,
`--final-locked`, `--expected-freeze <full sha>` and
`STATEPROOF_FINAL_LOCKED_CONFIRM=I_UNDERSTAND_THIS_IS_THE_FINAL_LOCKED_RUN`,
refuse a dirty tree or a mismatched HEAD, and refuse outright once a workflow
has completed. Every attempt is in
[`submission/final-evaluation-ledger.jsonl`](submission/final-evaluation-ledger.jsonl).

**These commands cannot be re-run**, by design. They are recorded here so the
protocol is legible, not so it can be repeated:

```bash
STATEPROOF_FINAL_LOCKED_CONFIRM=I_UNDERSTAND_THIS_IS_THE_FINAL_LOCKED_RUN pnpm benchmark:baseline-hard -- --split locked --final-locked   --expected-freeze c976e3838477afbf951d0faf57011be1b4ef6864

env -u STATEPROOF_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY STATEPROOF_FINAL_LOCKED_CONFIRM=I_UNDERSTAND_THIS_IS_THE_FINAL_LOCKED_RUN pnpm benchmark:stateproof-hard -- --split locked --final-locked   --contracts-from RUN-stateproof-hard-development-cold-20260829T022133Z-contracts   --expected-freeze c976e3838477afbf951d0faf57011be1b4ef6864
```

The locked StateProof run needs no credential at all: the four locked tasks
resolve to the three contracts compiled during development.

## What the recorded runs cost

| Run | Model calls | Tokens | Wall clock |
| --- | --- | --- | --- |
| Frontier baseline (Hard-12 development) | 8 | 84,616 | 115.1 s |
| Frontier baseline (Hard-12 locked) | 4 | 40,538 | 41.9 s |
| StateProof v3 cold (development) | 3 | 29,889 | 53.6 s |
| StateProof v3 warm (development) | 0 | 0 | 0.386 s |
| StateProof v3 locked | 0 | 0 | 0.201 s |
| **Baseline, all 12** | **12** | **125,154** | **157.0 s** |
| **StateProof first deployment, all 12** | **3** | **29,889** | **53.6 s** |
| **StateProof repeated, all 12** | **0** | **0** | **0.587 s** |

USD cost is not stated: no pricing rule is implemented, and inventing one would
be a fabricated number in a project about not fabricating numbers.
