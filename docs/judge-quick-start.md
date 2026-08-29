# Judge quick start

**No API key is required for anything on this page.** Nothing here makes a model
call, and both credential variables are removed from the environment by
`pnpm final:verify` so that no step can make one by accident.

## Requirements

- Node.js `>=20.10.0` (verified on v20.10.0)
- pnpm `>=8.12.0` (verified on 8.12.0)

## The fastest path — the interactive product

```bash
pnpm install
pnpm product:build
pnpm product:dev
```

Open **<http://localhost:4180/>**.

| Route | What it is |
| --- | --- |
| `/#/` | The worked example: what was asked, what the agent reported, what the state shows |
| `/#/demo` | `PBH-B03` — press **Verify this run** |
| `/#/import` | Upload a run package; a sample is one click away |
| `/#/runs/<id>` | The run inspector, after a verification |
| `/#/benchmark` | Development, locked and combined results |
| `/dashboard/` | The static evidence dashboard, served by the same server |

Three minutes, in order:

1. **Home.** The panel at the top is not a screenshot and not copy — the server
   runs the frozen verifier on load and renders what it found. The claim on the
   left is the agent's own final response.
2. **Demo → Verify this run.** Watch the verdict land: `FAIL`, five
   requirements, three contradicted, **0 model calls / 0 tokens**, about 1 ms of
   deterministic verification.
3. **In the inspector**, click any evidence reference. It scrolls to the exact
   event, record or diff row it names. Then look at the timeline: the human
   approval is at `seq 12` and `refund.execute` at `seq 8`. That fault is
   invisible in the agent's summary *and* in the tool log, because the call
   carried an `approvalReference` argument.
4. **Import → Download a sample run package**, then upload it back. It is
   `PBH-A01`, a different task template, and it verifies to `PASS` against a
   different frozen contract — also with zero model calls.
5. **Benchmark.** The measured result, every value read from
   `submission/final-evaluation.json`.

## The verification path

```bash
pnpm install
pnpm reproduce
```

Expected: `RESULT: PASSED (27 checks)`. This re-verifies all twelve
PhantomBench-Hard cases from the committed contract bundle, compares canonical
predictions to the submitted hashes, recomputes development/locked/combined
metrics, checks every evidence reference, and confirms zero model calls and zero
tokens. Roughly **4 seconds** after install.

## Everything at once

```bash
pnpm final:verify
```

Runs typecheck, the full test suite, both fixture validations, the
credential-free reproduction, the artifact-integrity check, the dashboard build,
the sample package, the product build, the product tests, the secret scan, and a
documentation link check. It fails on any error.

Individual commands are all still available:

```bash
pnpm typecheck                  # TypeScript strict, workspace and product client
pnpm test                       # unit and integration suites
pnpm benchmark:validate         # Core-12 fixtures
pnpm benchmark:validate-hard    # Hard-12 fixtures
pnpm reproduce                  # credential-free replay of all 12 cases
pnpm reproduce:check            # artifacts, hashes and provenance only
pnpm dashboard:build            # static evidence dashboard
pnpm dev                        # serve the dashboard on http://localhost:4173/
pnpm sample:build               # rebuild samples/stateproof-sample-run.zip
pnpm scan:secrets               # credential, key and local-path scan
pnpm check:provenance <runId>   # re-derive a run's prompt hash from its commit
pnpm test:clean-reproduction    # clone HEAD to a temp dir and run it all offline
```

Timings for the offline path come from the clean-checkout report
([`../submission/clean-reproduction-report.md`](../submission/clean-reproduction-report.md)),
measured on Windows 11 / Node v20.10.0 / pnpm 8.12.0 in a fresh clone with no
`.env` and no `node_modules`.

## Reading the result honestly

- Both systems score **100% on all twelve cases**. The suite cannot separate
  them on accuracy. What separates them is cost, determinism, and evidence
  quality — the baseline emitted one citation on the locked split that resolves
  to nothing (`trajectory:no refund.create call`), against 116/116 for
  StateProof.
- **This is a 12-case synthetic evaluation** in one domain against one model
  family. It does not establish generalization beyond the submitted benchmark.
- Efficiency figures are withheld in code unless SVR 100%, CDR 100%, FVR 0% and
  evidence-reference validity 100% all hold. Two earlier iterations were cheaper
  than the baseline and are reported with no reduction figures at all.

## Verifying the integrity claims yourself

`pnpm check:provenance` re-derives a run's prompt hash from the commit its
manifest records. It **fails on purpose** for
`RUN-stateproof-hard-development-live-20260829T004039Z` — a documented Gate 3A
defect where that run predates its own commit. It is preserved rather than
repaired; see [`limitations.md`](limitations.md).

To prove the dashboard cannot invent a number, edit any pinned artifact and
rebuild: the build fails with `SubmissionArtifactError` rather than rendering.

To prove the product cannot either, edit `submission/final-evaluation.json` and
reload `/#/benchmark`: the page reports the file is unusable rather than showing
a plausible table.

## Optional: the live commands

These reproduce the *recorded* runs and are **not needed**. They require
`STATEPROOF_ANTHROPIC_API_KEY` in `.env` and cost roughly $0.91 (baseline) and
$0.26 (StateProof compilation) at the pricing snapshot in
[`../submission/final-pricing-manifest.json`](../submission/final-pricing-manifest.json).

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
| Submission narrative | [`../SUBMISSION.md`](../SUBMISSION.md) |
| Final result | [`../submission/final-evaluation.md`](../submission/final-evaluation.md) |
| Claims → evidence | [`../submission/final-claims-evidence-map.md`](../submission/final-claims-evidence-map.md) |
| Iteration history | [`../IMPROVEMENT_CHANGELOG.md`](../IMPROVEMENT_CHANGELOG.md) |
| The product | [`product-application.md`](product-application.md) |
| Architecture | [`architecture.md`](architecture.md) |
| Limitations | [`limitations.md`](limitations.md) |
| Security and data | [`security-and-data.md`](security-and-data.md) |
| Prompts | [`../prompts/`](../prompts/) |
| Raw model responses | [`../artifacts/model-responses/`](../artifacts/model-responses/) |
| Run manifests and reports | [`../artifacts/run-manifests/`](../artifacts/run-manifests/), [`../artifacts/reports/`](../artifacts/reports/) |
