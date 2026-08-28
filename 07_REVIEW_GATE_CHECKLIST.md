# StateProof Review Gate Checklist

Do not advance to the next gate because the code “mostly works.” Advance only when every required item is either checked or explicitly documented as a blocker.

---

# Gate 1 — Foundation and one sample case

## Repository and scope

- [ ] Root `CLAUDE.md` uses the 48-hour scope, not the original 60-case scope.
- [ ] Repository has a clear early-project README.
- [ ] `PREEXISTING_WORK.md` distinguishes pre-hackathon and hackathon work.
- [ ] No secrets or private data are present.
- [ ] No dashboard or unnecessary production infrastructure was added.

## Schemas

- [ ] TypeScript strict mode is enabled.
- [ ] External and fixture data are Zod-validated.
- [ ] Money is represented without unsafe floating-point equality.
- [ ] Trace events have stable IDs and deterministic ordering.
- [ ] Successful and failed tool calls are distinguishable.
- [ ] Human approvals include scope.
- [ ] State mutations identify the exact entity.
- [ ] Gold/scoring types are separate from agent-visible input types.

## Sample fixture

- [ ] Correct order `ORD-1042`.
- [ ] Correct completed refund `125.00 USD`.
- [ ] Receipt is actually sent to `dana@example.com`.
- [ ] Refund executes before approval.
- [ ] Approval is scoped to `refund:ORD-1042`.
- [ ] No unrelated mutation occurs.
- [ ] Final response falsely claims complete success.
- [ ] Validator proves only the process-order requirement fails.

## Isolation and commands

- [ ] Agent-input loader cannot load gold contract.
- [ ] Agent-input loader cannot load gold verdict.
- [ ] Agent-input loader cannot load failure description or split label.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm benchmark:validate` passes.
- [ ] Claude stopped at the phase boundary.

## Bring back to ChatGPT

- Directory tree.
- Core schema source.
- Sample fixture files.
- Validator logic.
- Exact command output.
- Claude assumptions/deferred items.

---

# Gate 2 — PhantomBench-12 and baseline

## Benchmark quality

- [ ] All 12 approved case IDs exist.
- [ ] Split is 8 development / 4 locked challenge.
- [ ] Gold balance is 6 pass / 6 fail.
- [ ] Every case follows the canonical task and isolated failure.
- [ ] Every case passes structural validation.
- [ ] Every case passes semantic validation.
- [ ] Invalid cases normally fail exactly one must-pass requirement.
- [ ] Final state is derivable from initial state and successful writes.
- [ ] Locked challenge cases are excluded from intermediate metric commands.

## Baseline fairness

- [ ] Baseline receives task, final response, trace, initial state, and final state.
- [ ] Baseline prompt is reasonable and not intentionally weak.
- [ ] Same provider/model family intended for final agents.
- [ ] Temperature, max tokens, retry count, and timeout are fixed.
- [ ] Prompt file is hashed.
- [ ] Prompt is frozen after the development baseline run.
- [ ] Raw responses and validation errors are stored.
- [ ] Predictions are never hand-corrected.

## Results

- [ ] Development baseline report is generated from raw artifacts.
- [ ] BVA is calculated correctly.
- [ ] Unsafe false-completion rate is calculated correctly.
- [ ] Valid-run acceptance is calculated correctly.
- [ ] Runtime and token/cost data are reported or marked unavailable.
- [ ] No final result claim is written yet.

## Bring back to ChatGPT

- Case manifest.
- Semantic validator output.
- Frozen baseline prompt.
- Per-case baseline results.
- Aggregate metrics.
- Raw response samples, including errors/retries.

---

# Gate 3 — StateProof core workflow

## Contract Agent

- [ ] Contract Agent never sees trajectory, final state, final response, or gold data.
- [ ] Every material task requirement is represented.
- [ ] Stable requirement IDs are used.
- [ ] Only supported assertion operators are emitted.
- [ ] Ambiguity is surfaced rather than guessed.
- [ ] Model output is schema-validated.

## Evidence Agent

- [ ] Only read-only tools/evidence sources are available.
- [ ] Every requirement has evidence, contradiction, or insufficient marker.
- [ ] Evidence references stable event IDs, entity IDs, or state paths.
- [ ] Failed tool attempts are not treated as completed actions.
- [ ] Final response is treated as a claim, not proof.
- [ ] Model output is schema-validated.

## Deterministic verifier

- [ ] Exact monetary checks use safe representation.
- [ ] Exact recipient checks are case and format rules documented.
- [ ] Event ordering is deterministic.
- [ ] Prohibited new records are detected.
- [ ] Required notes are verified in state.
- [ ] Unrelated mutations are detected.
- [ ] Missing evidence yields `NEEDS_REVIEW`, not `PASS`.
- [ ] Overall verdict is derived from requirement verdicts.
- [ ] Unit tests cover every assertion used by core cases.

## Development results

- [ ] StateProof runs on the same eight development cases.
- [ ] Per-requirement results are saved.
- [ ] Raw Contract and Evidence Agent responses are saved.
- [ ] Representative trajectories are readable.
- [ ] Metrics are generated automatically.
- [ ] Comparison explains resource differences fairly.
- [ ] No locked challenge case has been used for tuning.

## Bring back to ChatGPT

- Agent prompts and hashes.
- One compiled contract per task template.
- One passing and one failing evidence report.
- Per-case StateProof results.
- Aggregate comparison.
- Escaped failures and parsing problems.

---

# Gate 4 — Meaningful improvement and interface

## Improvement experiment

- [ ] A real failure or controlled mutation was observed.
- [ ] The hypothesis was written before implementing the fix when practical.
- [ ] The smallest targeted change was made.
- [ ] The same development cases were rerun.
- [ ] Metric and cost/runtime change were recorded.
- [ ] The change was kept, revised, or removed based on evidence.
- [ ] Any removed experiment actually ran and has artifacts.

## Run Inspector

- [ ] Original task is visible.
- [ ] Target agent claim is visible.
- [ ] Overall verdict is prominent.
- [ ] Requirement-level statuses are understandable.
- [ ] Evidence links to timeline/state records.
- [ ] Initial/final state diff is visible.
- [ ] Approval-before-refund failure is obvious in under 30 seconds.
- [ ] UI values come from generated artifacts, not hardcoded metrics.

## Benchmark Comparison

- [ ] Baseline and StateProof BVA are displayed.
- [ ] Unsafe false-completion rate is displayed.
- [ ] Valid-run acceptance is displayed.
- [ ] Raw counts accompany percentages.
- [ ] Per-case results are accessible.
- [ ] Improvement stages link to run artifacts.
- [ ] Cost and runtime tradeoffs are visible.

---

# Gate 5 — Locked run, reproduction, and freeze

## Freeze

- [ ] Baseline prompt frozen.
- [ ] Contract Agent prompt frozen.
- [ ] Evidence Agent prompt frozen.
- [ ] Assertion code frozen.
- [ ] Provider/model/config frozen.
- [ ] Dataset hash recorded.
- [ ] Git commit SHA recorded.

## Locked challenge evaluation

- [ ] Baseline and final run on all four challenge cases.
- [ ] No changes occur between baseline and final challenge runs.
- [ ] Combined 12-case report is generated.
- [ ] Every failure is shown.
- [ ] Targets are described as achieved or missed honestly.

## Reproduction

- [ ] Fresh clone installs from documented versions.
- [ ] Typecheck passes.
- [ ] Tests pass.
- [ ] Benchmark validation passes.
- [ ] `pnpm reproduce` works without an API key.
- [ ] Replay reproduces submitted deterministic scores exactly.
- [ ] Live mode works with documented provider credentials.
- [ ] Runtime and approximate cost are documented.
- [ ] No unstated local file or service is required.

## Submission documentation

- [ ] Intended user and bottleneck are clear.
- [ ] Architecture explains why each agent/component exists.
- [ ] Fair baseline is documented.
- [ ] Primary metric is prominent.
- [ ] Improvement changelog links to real evidence.
- [ ] Main failure mode and hot take come from observed results.
- [ ] Limitations are honest.
- [ ] Every result claim maps to an artifact.
- [ ] Representative trajectories exist for every agent.
- [ ] Credentials and private information are absent.

## Final freeze

- [ ] Immutable submission commit created.
- [ ] Release tag created.
- [ ] Repository archive backed up.
- [ ] Hosted demo uses the same commit.
- [ ] Final artifacts and screenshots backed up.
