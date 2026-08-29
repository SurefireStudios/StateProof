# Judge quickstart

**No API key is required for anything on this page.** Nothing here makes a model
call.

## Requirements

- Node.js `>=20.10.0` (verified on v20.10.0)
- pnpm `>=8.12.0` (verified on 8.12.0)

## The two-minute path

```bash
pnpm install
pnpm reproduce
```

Expected: `RESULT: PASSED (26 checks)`. This re-verifies all twelve
PhantomBench-Hard cases from the committed contract bundle, compares canonical
predictions to the submitted hashes, recomputes development/locked/combined
metrics, checks every evidence reference, and confirms zero model calls and zero
tokens. Roughly **4 seconds** after install.

## The full path

```bash
pnpm install                    # ~3 s
pnpm typecheck                  # ~3 s
pnpm test                       # ~18 s   478 tests, 0 skipped
pnpm benchmark:validate         # ~1 s    Core-12 fixtures
pnpm benchmark:validate-hard    # ~1 s    Hard-12 fixtures
pnpm reproduce                  # ~4 s    RESULT: PASSED (26 checks)
pnpm dashboard:build            # ~2 s    static site into apps/dashboard/dist/
pnpm dev                        #         serves it on http://localhost:4173/
```

Timings are from the clean-checkout report
([`submission/clean-reproduction-report.md`](submission/clean-reproduction-report.md)),
measured on Windows 11 / Node v20.10.0 / pnpm 8.12.0 in a fresh clone with no
`.env` and no `node_modules`.

## What to look at, in order

1. **`pnpm dev` → Overview** — the problem, the architecture, and the final
   numbers, every one of them read from a run artifact.
2. **Run Inspector → `PBH-B03`** — a run whose final response reads like success
   and whose state says otherwise: wrong refund amount, approval *after* the
   protected action, missing support note. Click an evidence reference; it
   scrolls to the exact event or record it names.
3. **Run Inspector → `PBH-A04` or `PBH-C04`** — locked cases, evaluated once
   after the freeze.
4. **Benchmark** — development, locked and combined tables side by side, plus
   the two earlier iterations that failed their guardrails and are reported with
   no efficiency claim at all.
5. **Changelog** — seven stages, two of them failures, each linking to its
   report, manifest, prompt and decision record.
6. **Trajectories** — every model call this project made, with its exact input
   envelope. Check that the Contract Agent envelopes contain no trajectory, no
   state and no final response.

## Reading the result honestly

- Both systems score **100% on all twelve cases**. The suite cannot separate
  them on accuracy. What separates them is cost, determinism, and evidence
  quality — the baseline emitted one citation on the locked split that resolves
  to nothing (`trajectory:no refund.create call`), against 116/116 for
  StateProof.
- **This is a 12-case synthetic evaluation.** It does not establish
  generalization beyond the submitted benchmark.
- Efficiency figures are withheld in code unless SVR 100%, CDR 100%, FVR 0% and
  evidence-reference validity 100% all hold. Two earlier iterations were cheaper
  than the baseline and are reported with no reduction figures.

## Verifying the integrity claims yourself

```bash
pnpm reproduce:check                         # artifacts, hashes, provenance only
pnpm scan:secrets                            # credential and private-path scan
pnpm check:provenance RUN-stateproof-hard-development-cold-20260829T022133Z
pnpm test:clean-reproduction                 # clone HEAD to a temp dir, run it all offline
```

`pnpm check:provenance` re-derives a run's prompt hash from the commit its
manifest records. It **fails on purpose** for
`RUN-stateproof-hard-development-live-20260829T004039Z` — a documented Gate 3A
defect where that run predates its own commit. It is preserved rather than
repaired; see [`docs/limitations.md`](docs/limitations.md).

To prove the dashboard cannot invent a number, edit any pinned artifact and
rebuild: the build fails with `SubmissionArtifactError` rather than rendering.

## Optional: the live commands

These reproduce the *recorded* runs and are **not needed**. They require
`STATEPROOF_ANTHROPIC_API_KEY` in `.env` and cost roughly $0.91 (baseline) and
$0.26 (StateProof compilation) at the pricing snapshot in
[`submission/final-pricing-manifest.json`](submission/final-pricing-manifest.json).

```bash
pnpm benchmark:smoke-model
pnpm benchmark:baseline-hard -- --split development
pnpm benchmark:stateproof-hard -- --split development \
  --prompt prompts/contract-agent/v3.md \
  --baseline-run RUN-baseline-hard-development-live-20260828T233139Z
```

The locked split cannot be run again: the one-time protocol refuses a workflow
that has already completed, and the ledger records that both did.

## Where things are

| | |
| --- | --- |
| Submission narrative | [`SUBMISSION.md`](SUBMISSION.md) |
| Final result | [`submission/final-evaluation.md`](submission/final-evaluation.md) |
| Claims → evidence | [`submission/final-claims-evidence-map.md`](submission/final-claims-evidence-map.md) |
| Iteration history | [`IMPROVEMENT_CHANGELOG.md`](IMPROVEMENT_CHANGELOG.md) |
| Limitations | [`docs/limitations.md`](docs/limitations.md) |
| Architecture | [`docs/architecture.md`](docs/architecture.md) |
| Prompts | [`prompts/`](prompts/) |
| Raw model responses | [`artifacts/model-responses/`](artifacts/model-responses/) |
| Run manifests and reports | [`artifacts/run-manifests/`](artifacts/run-manifests/), [`artifacts/reports/`](artifacts/reports/) |
