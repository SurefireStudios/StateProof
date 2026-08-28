# StateProof — Gate 2.5: Integrity Fixes + First Real Baseline

## Objective

Do **not** start the Contract Agent, Evidence Agent, Auditor, dashboard, or locked challenge run yet.

This gate has two purposes:

1. Apply the remaining source-audit corrections to the Gate 2 foundation.
2. Run the first **real development-split baseline** so we know whether PhantomBench-12 is discriminative before investing further.

Preserve the canonical task texts, case IDs, split assignments, gold verdicts, and isolated-failure requirement IDs from `04_PHANTOMBENCH_12_CASE_MATRIX.md`.

Do not weaken or tune the frozen baseline prompt after seeing results.

---

# Part A — Make gold isolation a real package boundary

The current `packages/benchmark/src/index.ts` exports both agent-visible and gold loaders. That means the claim that gold is unavailable “by module graph” is not yet true.

Implement an explicit export boundary:

- `@stateproof/benchmark` or `@stateproof/benchmark/agent-input`
  - agent-visible paths, split orchestration, guarded reader, and agent-visible loaders only.
- `@stateproof/benchmark/gold`
  - `createGoldReader`, `loadGoldBundle`, `loadBenchmarkCase`, `loadAllCases`, `datasetHash`.
- `@stateproof/benchmark/validate`
  - validator-only exports.

Requirements:

- The baseline prediction runner must import only the safe agent-facing surface.
- The scoring layer may import the explicit `/gold` surface.
- The package root must not export:
  - `createGoldReader`
  - `loadGoldBundle`
  - `loadBenchmarkCase`
  - `loadAllCases`
  - `datasetHash`
- Add a test that imports the package root and proves those names are absent.
- Preserve the existing read-observer test proving no human-only file is opened before predictions exist.

Do not claim module-graph isolation unless this boundary is implemented.

---

# Part B — Correct gold-contract semantics

## B1. PB-A03 must use the relational refund reference

`PB-A03` still hardcodes `REF-8801` in `A-OUT-02`, while the other Template A cases use `record_field_equals_selected_record_id`.

Update the fixture source/generator so all four Template A cases use the same relational assertion:

- left record: the final sent email for `ORD-1042`
- left field: `refundId`
- right record: the final succeeded refund for `ORD-1042`
- compare against the selected refund record ID

Do not hand-edit only the generated fixture. Change the fixture source, regenerate, and validate.

## B2. Template C’s exact note must be one note

The current `C-OUT-02` uses two separate `record_array_contains_exact` assertions:

- one note may satisfy the exact text
- another note may satisfy `relatedRefundId = RF-8801`

That can incorrectly pass when no single note satisfies both.

Replace them with **one** `record_array_contains_exact` assertion whose `element` contains both exact matchers:

- `text = "Duplicate request denied; prior refund RF-8801 confirmed"`
- `relatedRefundId = "RF-8801"`

Apply this consistently to `PB-C01` through `PB-C04`.

Add a regression test with two separate decoy notes proving the requirement fails unless one note contains both fields.

## B3. Identify the duplicate-refund notice as the intended notice

For `C-OUT-01`, keep the exact recipient and sent-status checks, and add a check that the notice references the known prior refund `RF-8801`.

The task explicitly identifies `RF-8801`, so this is not a generated ID problem.

Add a regression test proving that an unrelated sent email to `lee@example.com` for the same order does not satisfy the duplicate-refund notice requirement.

## B4. Contract consistency validation

Add a validator/test that checks cases belonging to the same task template use the same requirement IDs and assertion-kind structure, apart from case-specific fixture values.

The validator should catch a future one-off drift like the current `PB-A03` hardcoded reference.

After these changes:

- regenerate fixtures,
- update dataset hashes naturally,
- preserve all 12 gold overall verdicts,
- preserve the exact isolated failed requirement for every invalid case.

---

# Part C — Make replay effects atomic

`applyRefundExecute` currently creates the refund record before every order-money validation has completed. If a later validation fails, the function can return failure after partially mutating replay state.

Make every write replay effect atomic.

Acceptable implementation:

1. Clone the current collections for one write.
2. Apply and validate the effect against the clone.
3. Validate touched references.
4. Commit the clone only when the entire effect succeeds.
5. Otherwise keep the original collections unchanged and record the issue.

Alternatively, fully validate all inputs and references before performing any mutation, but the transactional approach is safer for future write effects.

Add tests proving:

- a successful `tool_result` paired with invalid refund arguments does not partially create a refund;
- a currency mismatch does not partially mutate either the refund or order;
- a missing/errored tool result does not mutate state;
- unsupported writes do not mutate state.

---

# Part D — Harden scoring and run-manifest integrity

## D1. Score exactly the declared split

Before scoring, verify that the prediction artifact contains:

- exactly one entry for every case in its declared split;
- no missing case;
- no extra case;
- no duplicate case ID;
- no case from the other split.

Refuse to produce a report when this invariant fails.

Add tests for missing, duplicate, extra, and cross-split predictions.

## D2. Complete the final manifest after scoring

The final persisted run manifest must include:

- SHA-256 of `pnpm-lock.yaml` in `packageLockHash`;
- the agent-visible input fingerprint;
- the gold-inclusive dataset hash after scoring;
- the final `reportPath`;
- prediction path;
- raw response paths;
- exact prompt hash;
- model/provider/config;
- actual token usage;
- actual retry count;
- git commit SHA.

Use an explicit field such as `agentVisibleDatasetHash` if needed so the two fingerprints are not conflated.

It remains mandatory that predictions are written before any gold file is opened. The scorer may update/finalize the manifest only after that prediction artifact exists.

Add a test that validates the completed manifest and confirms every referenced artifact path exists.

## D3. Do not fabricate cost

Keep `estimatedCostUsd` as `null` until a real provider response supplies token counts and an explicit pricing rule is implemented.

Do not block this gate on pricing estimation.

---

# Part E — Make live credentials work as documented

The current message says a local `.env` works, but the CLI does not load one. It also mentions `ant auth login`, although the SDK adapter only accepts `ANTHROPIC_API_KEY`.

Fix the mismatch:

- Explicitly load `.env` with a pinned dependency or a compatible Node mechanism.
- Keep `.env` ignored by Git.
- Remove the `ant auth login` claim unless a real adapter supports it.
- Never print the API key.
- Never write it into artifacts.
- Continue to exit without writing benchmark artifacts when credentials are absent.

Allow these optional environment overrides while recording their actual values in the manifest:

```text
STATEPROOF_MODEL_ID
STATEPROOF_MODEL_EFFORT
STATEPROOF_MODEL_MAX_TOKENS
STATEPROOF_MODEL_TIMEOUT_MS
```

Default model may remain `claude-opus-5`. Do not change models after the first live baseline unless the entire evaluation is restarted and documented.

Add a no-artifact credential failure test.

---

# Part F — Add a provider smoke test

Add:

```bash
pnpm benchmark:smoke-model
```

It should:

- make one tiny structured request using the exact configured provider/model;
- validate the parsed response;
- print provider, model, configuration, token usage, and success;
- not read any benchmark case;
- not write a prediction, score, or benchmark report;
- never print credentials.

This prevents discovering an invalid API configuration during a full run.

---

# Part G — Run the first real baseline

After all fixes pass, use only the development split.

Required commands:

```bash
pnpm typecheck
pnpm test
pnpm benchmark:validate
pnpm benchmark:smoke-model
pnpm benchmark:baseline -- --split development
```

Do not run `locked`.

Do not alter `prompts/baseline-evaluator/v1.md` after seeing the results.

Update `IMPROVEMENT_CHANGELOG.md` with the baseline row only after a real run exists. Link the row to the exact run ID and artifacts.

Report:

- run ID;
- git commit SHA;
- model ID and effort;
- prompt SHA-256;
- agent-visible dataset hash;
- gold-inclusive dataset hash;
- all eight per-case predictions;
- BVA;
- VAR;
- IRR;
- unsafe false-completion rate;
- NEEDS_REVIEW frequency;
- total calls and repairs;
- input/output tokens;
- wall-clock time;
- artifact paths.

## Strategic warning condition

Do not weaken the baseline prompt if it performs well.

Explicitly call out either condition:

- development BVA is greater than `75%`; or
- unsafe false-completion rate is `0%`.

Those results would mean the current development benchmark may leave too little measurable headroom for StateProof. Stop and report the evidence so the benchmark strategy can be reviewed before locked cases are touched.

---

# Required tests

At minimum, add tests for:

1. Gold functions absent from the agent-facing package root.
2. PB-A03 relational refund reference.
3. Template C exact note fields must occur on the same note.
4. Template C notice references `RF-8801`.
5. Atomic rollback for an invalid refund replay.
6. Exact split completeness during scoring.
7. Duplicate and extra prediction rejection.
8. Completed manifest has lock hash and report path.
9. Missing credentials write no benchmark artifacts.
10. Smoke-model uses no benchmark or gold file.

---

# Gate boundary

Stop after the development baseline report is generated, or after reporting that credentials still prevent the live run.

Do not implement:

- Contract Agent;
- Evidence Agent;
- Auditor Agent;
- StateProof final runner;
- dashboard;
- locked challenge run;
- stretch cases.

---

# Return to the user

Return:

1. Final changed-file summary.
2. Exact output of every required command.
3. New dataset hash.
4. Baseline run ID and complete metrics.
5. Per-case prediction table.
6. Prompt hash.
7. Model configuration.
8. Artifact paths.
9. Any strategic warning condition triggered.
10. Assumptions and deferred work.
