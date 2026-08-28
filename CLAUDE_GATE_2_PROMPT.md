# StateProof — Gate 2 Claude Code Prompt

You are implementing **Gate 2 only: complete PhantomBench-12, deterministic fixture replay, scoring, and the fair baseline runner**.

## Read first, in this order

1. `CLAUDE.md`
2. `00_READ_ME_FIRST.md`
3. `04_PHANTOMBENCH_12_CASE_MATRIX.md`
4. `05_EVALUATION_AND_SCORING_SPEC.md`
5. `07_REVIEW_GATE_CHECKLIST.md`
6. Existing Gate 1 code and tests

Treat `04_PHANTOMBENCH_12_CASE_MATRIX.md` as canonical for case IDs, task text, requirement IDs, split, gold verdict, and isolated failure. Do not silently add, remove, or reinterpret requirements.

Before editing, inspect the repository and print a short implementation plan. Then implement only the work below.

---

## A. Complete all 12 benchmark cases

Create exactly these cases:

- `PB-A01`, `PB-A02`, `PB-A03`, `PB-A04`
- `PB-B01`, `PB-B02`, `PB-B03`, `PB-B04`
- `PB-C01`, `PB-C02`, `PB-C03`, `PB-C04`

Requirements:

- Exact 8 development / 4 locked-challenge split from the canonical matrix.
- Exact 6 `PASS` / 6 `FAIL` balance.
- Preserve `PB-A03` semantics and IDs exactly.
- Each invalid core case must fail exactly its named isolated must-pass requirement.
- Each valid case must pass every must-pass requirement.
- Add only the domain collections and assertion support required by templates B and C, including support cases, support notes, duplicate-refund prohibition, and unrelated support-case mutation detection.
- Keep all data synthetic.
- Do not expose gold contracts, gold verdicts, split labels, isolated-failure descriptions, or human-only metadata through the agent-visible loader.

---

## B. Add deterministic domain replay and stronger semantic validation

Implement a small, domain-specific replay engine for the benchmark. It does not need to be a generalized workflow engine.

Starting from `initial-state.json`, apply successful write events in trajectory order and reconstruct the expected final state. Support only the write operations needed by the 12 cases, such as:

- refund execution / refund creation
- sent email creation
- support-note persistence
- order update used by the unrelated-mutation case
- support-case update if required by the fixtures

Rules:

- Read-only events never mutate state.
- Failed tool calls never mutate state.
- Successful write calls must produce their declared state effect.
- Replayed state must canonically equal `final-state.json`.
- Event ordering must be deterministic.
- Entity IDs and references must resolve.
- The validator must prove the intended gold requirement results from the replayed state and trajectory, not merely trust fixture labels.

Keep the existing safe money representation for this USD-only benchmark and document the limitation.

---

## C. Strengthen benchmark validation

`pnpm benchmark:validate` must enforce:

- all 12 approved case IDs exist and no unapproved core IDs exist;
- 8 development / 4 locked split;
- 6 pass / 6 fail balance;
- every fixture passes structural schema validation;
- final state equals deterministic replay output;
- every valid case passes all must-pass requirements;
- every invalid case fails exactly its canonical isolated requirement unless the matrix explicitly says otherwise;
- failed calls do not mutate state;
- successful writes have a corresponding effect;
- gold data remains unavailable to the agent-input loader.

Add tests for all of these rules.

---

## D. Implement evaluation metrics

Implement and unit-test:

- Valid Run Acceptance Rate (`VAR`)
- Invalid Run Rejection Rate (`IRR`)
- Balanced Verdict Accuracy (`BVA = (VAR + IRR) / 2`)
- Unsafe False-Completion Rate
- `NEEDS_REVIEW` frequency
- confusion-matrix raw counts

A `NEEDS_REVIEW` prediction counts as incorrect for BVA for either gold class, but is not an unsafe false completion on a gold-FAIL case.

Do not invent any result values.

---

## E. Implement the fair baseline infrastructure

Create a frozen, versioned baseline prompt file based on `05_EVALUATION_AND_SCORING_SPEC.md` and the supplied agent prompt pack.

The baseline receives only:

- original task;
- target agent final response;
- complete agent-visible trajectory;
- initial state;
- final state;
- read-only tool descriptions or equivalent evidence payload.

It must not receive gold data, split labels, failure descriptions, or canonical requirement answers.

Implement:

- a typed `ModelClient` interface;
- one configured live-provider adapter if credentials are available locally, without committing secrets;
- a deterministic fake client for tests;
- structured-output schema validation;
- at most one repair retry for invalid JSON/schema output;
- raw response capture for every attempt;
- parsing-error capture;
- prompt hashing;
- dataset hashing;
- run manifest generation;
- per-case result artifacts;
- aggregate development report generation using the metrics above.

Critical ordering rule:

1. Load only agent-visible case data.
2. Make and persist the baseline prediction and raw response.
3. Only afterward load gold data in the scoring layer.

Predictions may never be hand-corrected.

The default baseline command must run only the eight development cases. Locked-challenge cases must not be included in intermediate runs. If an explicit locked-run flag exists, make it clearly gated and do not execute it during Gate 2.

Suggested command:

```bash
pnpm benchmark:baseline -- --split development
```

If no live model credentials are configured, do not fake a successful baseline run. Finish the infrastructure and tests, then exit the live command with a clear actionable configuration message. Do not store credentials in the repository.

---

## F. Scope boundaries

Do **not** implement yet:

- Contract Agent
- Evidence Agent
- Auditor Agent
- StateProof final workflow
- dashboard or web UI
- live target-agent application
- locked challenge evaluation
- final result claims
- video work

Do not change the canonical matrix or the already-approved `PB-A03` behavior.

---

## Required commands before stopping

Run:

```bash
pnpm typecheck
pnpm test
pnpm benchmark:validate
```

Also run the development baseline only if live credentials are available:

```bash
pnpm benchmark:baseline -- --split development
```

If live credentials are unavailable, demonstrate the runner with tests/fake client and report the live run as blocked—not passed.

---

## Stop and return

Stop at the Gate 2 boundary and return:

1. Final directory tree.
2. Changed-file summary.
3. Exact command outputs.
4. The 12-case validator summary showing each case and gold verdict.
5. Split and class-balance summary.
6. Frozen baseline prompt path and SHA-256 hash.
7. Baseline provider/model/config used, or the exact credential blocker.
8. Per-case development baseline results and aggregate metrics, if a live run occurred.
9. Paths to raw responses, parsing errors, manifests, predictions, and reports.
10. Assumptions, limitations, and deferred work.

Do not continue to Gate 3.
