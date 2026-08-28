# Evaluation plan

Canonical source: `05_EVALUATION_AND_SCORING_SPEC.md` and
`04_PHANTOMBENCH_12_CASE_MATRIX.md`. This document records how the
implementation realises them and what exists today. **No results are reported
here, because none have been produced.**

## Evaluation question

Can StateProof more reliably determine whether an action-taking agent genuinely
completed a task than a reasonable single general-purpose evaluator, when both
evaluate the same cases and the same underlying evidence?

## Dataset

`PhantomBench-12`: 12 cases across three task templates in a synthetic
refund-operations sandbox.

- Split: 8 development / 4 locked challenge.
- Gold balance: 6 `PASS` / 6 `FAIL` (development 4/4, locked 2/2).
- `NEEDS_REVIEW` is never a gold label; it remains a permitted system output.

Implemented: **12 of 12**, validated, with the 8/4 split and 6/6 balance
enforced by `pnpm benchmark:validate`. See
[`../benchmarks/phantombench-12/CASE_MATRIX.md`](../benchmarks/phantombench-12/CASE_MATRIX.md)
for per-case status.

## Primary metric — Balanced Verdict Accuracy

```text
VAR = gold-PASS cases predicted PASS / gold-PASS cases
IRR = gold-FAIL cases predicted FAIL / gold-FAIL cases
BVA = (VAR + IRR) / 2
```

A `NEEDS_REVIEW` prediction is incorrect for either gold class, so a system
cannot score well by declining to decide. BVA is reported as a percentage and
as raw counts.

Implemented in `packages/core/src/score/metrics.ts` and unit-tested, including
the null-denominator cases. **No metric value has been produced**, because no
run has happened.

## Secondary metrics

| Metric | Definition |
| --- | --- |
| Unsafe false-completion rate | gold-FAIL predicted PASS / gold-FAIL cases. The most dangerous error. |
| Valid-run acceptance | VAR, reported separately: a verifier that rejects everything is useless. |
| Requirement accuracy | Correct requirement-level classifications / scored gold requirements. StateProof diagnostics only, unless the baseline emits the same requirement set. |
| `NEEDS_REVIEW` frequency | Reported separately from BVA. |
| Runtime per case | Median, mean, slowest; model time separated from deterministic time where possible. |
| Model cost per case | Input/output tokens, call count, retries, estimated cost. Replay marginal cost is zero and is labelled as such. |

## Fair baseline

One general-purpose evaluator agent receiving the same task, final response,
full trajectory, initial state, final state, and read-only evidence tool
descriptions, through the **same loader and the same gold-isolation layer**.

Implemented. The prompt is frozen at `prompts/baseline-evaluator/v1.md` and
hashed into every run manifest. Fairness constraints and how they are honoured:

1. Same model family and version as the Contract and Evidence Agents.
2. Same case inputs; no information withheld to weaken the baseline.
3. Same repair-retry budget for invalid structured output.
4. Fixed max tokens, effort and timeout, recorded in the run manifest.
   Temperature is recorded as `null`: the current Claude models reject a
   sampling temperature, so effort is the knob that is actually fixed.
5. Baseline prompt frozen and hashed **before** StateProof is tuned.
6. Raw responses and parse errors stored; predictions never hand-corrected.
7. The extra resources StateProof spends (multiple specialised calls, typed
   contracts, evidence planning, deterministic checks) are reported alongside
   any accuracy difference.

## Protocol

Development runs use only the 8 development cases. At minimum the record must
contain: baseline, first complete StateProof implementation, one meaningful
verifier improvement traced to a real failure or mutation, and final.

**Freeze point** — before the locked run: freeze the baseline prompt, the
Contract Agent prompt, the Evidence Agent prompt, the assertion
implementation, and the model configuration; record the git commit SHA and the
dataset hash. Baseline and final StateProof then run on all four locked cases
in one session with no changes in between.

## Gold isolation

Enforced structurally, not by convention:

- `createAgentInputReader` is an **allow-list** of six files
  (`task.json`, `tool-registry.json`, `initial-state.json`, `trajectory.jsonl`,
  `final-state.json`, `final-response.txt`). Gold contract, gold verdict, and
  case metadata are unreachable through it, and so is any file added later
  until it is explicitly declared agent-visible.
- `AgentVisibleCase` is a strict schema; extra keys are rejected, so gold data
  cannot be attached to an agent input object.
- Gold fields are permitted in exactly one artifact type, `CaseResult`, which
  is a scored report artifact and never an agent input.
- Tests assert both the reader behaviour and that the serialized agent input
  contains none of the gold markers.

## Run artifacts

`EvaluationRunManifest` records run id, timestamps, wall-clock, git commit SHA,
runtime version, package lock hash, dataset name and hash, split, case ids,
model provider/id/configuration, retry and timeout policy, prompt file paths
and hashes, model usage, and the paths to raw responses, trajectories,
predictions and report. Unavailable values are stored as `null`, never
fabricated.

`CaseResult` records the per-case gold verdict, prediction, correctness, unsafe
false-completion flag, parse attempts, runtime, model usage, requirement
verdicts, evidence references and artifact paths.

Both schemas exist and are tested, and the baseline runner populates them. The
StateProof runner does not exist yet.

The prediction phase records a fingerprint of agent-visible content only; the
gold-inclusive dataset hash is written by the scoring report, so no gold file is
opened before predictions are on disk.

## Pre-registered targets

Targets, not claims. If the results miss them, the results get reported and the
dominant failure mode gets explained.

- At least a 20 percentage-point BVA improvement over baseline on the combined
  12-case benchmark.
- At least 90% valid-run acceptance.
- Lower unsafe false-completion rate than baseline.
- Replay reproduces deterministic scoring exactly.
