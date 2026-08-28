# Progress

## Gate 1 — Foundation and one sample case: complete

Delivered:

- pnpm workspace with `packages/core` and `packages/benchmark`, strict
  TypeScript, exact-pinned dependencies.
- Ten-plus Zod schemas: `TaskSpec`, `ToolDefinition`/`ToolRegistry`,
  `TraceEvent`/`Trajectory`, `StateSnapshot`, `Assertion`,
  `ContractRequirement`/`TaskContract`, `EvidenceRecord`,
  `RequirementVerdict`/`RunVerdict`/`GoldVerdict`,
  `AgentVisibleCase`/`CaseMetadata`/`BenchmarkCase`/`SplitManifest`,
  `EvaluationRunManifest`, `CaseResult`.
- Deterministic engine: snapshot diffing, the seven-kind assertion vocabulary,
  requirement conjunction, and verdict roll-up.
- Benchmark loader with structural gold isolation, fixture validator, and the
  `benchmark:validate` CLI.
- `PB-A03` — one complete, canonical case proving the signature failure.
- 99 tests across 7 files.

Verified: `pnpm typecheck`, `pnpm test`, `pnpm benchmark:validate` all pass
offline with no provider key.

### Gate 1 checklist status

Against `07_REVIEW_GATE_CHECKLIST.md`:

| Item | Status |
| --- | --- |
| Root `CLAUDE.md` uses the 48-hour scope | Yes — verbatim copy of `01_CLAUDE_48H.md` |
| Clear early-project README | Yes, status stated in the first line |
| `PREEXISTING_WORK.md` distinguishes prior work | Yes — no prior work exists |
| No secrets or private data | Yes — `.env.example` has names only |
| No dashboard or production infrastructure | Yes |
| TypeScript strict mode | Yes, plus `noUncheckedIndexedAccess` |
| External/fixture data Zod-validated | Yes |
| Money without unsafe float equality | Yes — two-decimal strings |
| Stable trace event ids, deterministic ordering | Yes — `eventId` + gap-free `seq` |
| Successful and failed tool calls distinguishable | Yes — `tool_result.status` |
| Human approvals include scope | Yes — required field |
| State mutations identify the exact entity | Yes — diff is per record id |
| Gold/scoring types separate from agent-visible types | Yes |
| Correct order `ORD-1042` | Yes |
| Correct completed refund `125.00 USD` | Yes — `REF-8801` |
| Receipt actually sent to `dana@example.com` | Yes — `MSG-5501`, status `sent` |
| Refund executes before approval | Yes — `seq 5` vs `seq 9` |
| Approval scoped to `refund:ORD-1042` | Yes |
| No unrelated mutation | Yes — `ORD-1043`, `ORD-1044` unchanged |
| Final response falsely claims success | Yes |
| Validator proves only the process-order requirement fails | Yes — `A-PROC-01`, asserted by test |
| Loader cannot load gold contract / verdict / failure description / split | Yes — allow-list reader, asserted by test |
| `pnpm typecheck` / `pnpm test` / `pnpm benchmark:validate` pass | Yes |
| Stopped at the phase boundary | Yes |

## Course correction during gate 1

The kickoff prompt specified the sample case as `PB-001` with locally invented
requirement ids. Partway through, the canonical pack
(`04_PHANTOMBENCH_12_CASE_MATRIX.md`) became available and names this exact
case `PB-A03`, with gold requirements `A-OUT-01`, `A-OUT-02`, `A-PROC-01` and
`A-SCOPE-01`. The fixture, ids, and canonical task text were realigned to the
matrix, since the matrix is explicitly the canonical benchmark source and the
brief forbids silently changing requirements. Two requirements invented earlier
(`no new orders created`, `response accuracy`) were dropped: they are not in the
approved matrix for task template A.

## Gate 2 — complete except the live baseline run

Delivered:

- **All 12 PhantomBench-12 cases**, 8 development / 4 locked, 6 gold PASS / 6
  gold FAIL, each invalid case failing exactly its canonical isolated
  requirement. `PB-A03` is unchanged from Gate 1.
- **Deterministic replay engine** for the refund-operations sandbox. Every
  fixture's final state is reconstructed from its initial state plus its
  successful write events and must match exactly.
- **Two new assertion kinds** — a relational record-reference check and an
  exact array-element check — plus event-selector combination validation.
- **Referential integrity** and **metadata hygiene** checks across the fixtures.
- **Metrics**: VAR, IRR, BVA, unsafe false-completion rate, NEEDS_REVIEW
  frequency, confusion matrix. Pure functions, unit-tested, never hardcoded.
- **Fair baseline infrastructure**: frozen hashed prompt, typed `ModelClient`,
  live Anthropic adapter, deterministic fake client for tests, structured
  output with one repair retry, raw capture of every attempt, parse-error
  capture, run manifests, per-case results, and an aggregate report generated
  from artifacts.
- 188 tests across 12 files.

**Blocked, not passed: the live development baseline run.** No model
credentials are configured on this machine (`ANTHROPIC_API_KEY` unset, no `ant`
CLI, no `.env`), so `pnpm benchmark:baseline` exits non-zero with an actionable
message and writes nothing. The runner is exercised end to end in tests with
the deterministic fake client. No baseline metric exists yet, and none has been
invented.

### Gate 2 checklist status

Against `07_REVIEW_GATE_CHECKLIST.md`:

| Item | Status |
| --- | --- |
| All 12 approved case IDs exist | Yes |
| Split is 8 development / 4 locked | Yes, enforced by the validator |
| Gold balance is 6 pass / 6 fail | Yes, enforced by the validator |
| Every case follows the canonical task and isolated failure | Yes, cross-checked against a matrix registry |
| Every case passes structural validation | Yes |
| Every case passes semantic validation | Yes |
| Invalid cases fail exactly one must-pass requirement | Yes, asserted per case |
| Final state derivable from initial state and successful writes | Yes, by replay equality |
| Locked cases excluded from intermediate commands | Yes, and the CLI refuses the locked split without an explicit override |
| Baseline receives task, response, trace, both states | Yes, and nothing else |
| Baseline prompt reasonable, not weakened | Yes — the canonical prompt-pack text |
| Same provider/model family intended for final agents | Yes, one shared `ModelClient` and configuration |
| Temperature, max tokens, retries, timeout fixed | Yes; temperature recorded as null because the model rejects it |
| Prompt file hashed | Yes, into every manifest |
| Prompt frozen after the development baseline run | Frozen now; no run has happened |
| Raw responses and validation errors stored | Yes, every attempt |
| Predictions never hand-corrected | Yes, and unparsed cases are kept, not dropped |
| Development baseline report generated from raw artifacts | Infrastructure complete; **blocked on credentials** |
| BVA / unsafe false-completion / valid-run acceptance calculated correctly | Yes, unit-tested |
| Runtime and token/cost data reported or marked unavailable | Yes; cost is `null` until a live run |
| No final result claim written yet | Correct — none exists |

## Gate 2.5 — integrity fixes complete, live baseline still blocked

Source-audit corrections applied before the first real run. Details and
reasoning in [`decisions/0003-gate-2-5.md`](decisions/0003-gate-2-5.md).

| Part | Change |
| --- | --- |
| A | Gold isolation is a real package boundary: `@stateproof/benchmark`, `/gold`, `/validate`. A test proves the gold names are absent from the agent-facing root. |
| B1 | `PB-A03` moved under the generator so all four Template A cases use the relational refund reference. Agent-visible hash unchanged (`ccb483bdd838`). |
| B2 | `C-OUT-02` is one assertion requiring both note fields on the *same* note. Two decoy notes no longer satisfy it. |
| B3 | `C-OUT-01` identifies the notice by the prior refund `RF-8801` the task names, so an unrelated email to the same customer cannot stand in. |
| B4 | `validateContractConsistency` requires cases of one template to share requirement ids and assertion shapes. |
| C | Replay write effects are transactional: staged on a clone, committed only if the whole effect succeeds. |
| D1 | Scoring refuses unless the prediction file covers exactly its declared split — no missing, duplicate, extra or cross-split case. |
| D2 | The manifest carries `agentVisibleDatasetHash`, a real `packageLockHash`, and a `datasetHash`/`reportPath` completed after scoring. |
| D3 | `estimatedCostUsd` stays `null`. |
| E | `.env` is loaded via pinned `dotenv`. StateProof reads **`STATEPROOF_ANTHROPIC_API_KEY`**, never `ANTHROPIC_API_KEY`. |
| F | `pnpm benchmark:smoke-model` — one tiny structured request, no benchmark data, no artifacts. |

236 tests across 17 files. `pnpm typecheck`, `pnpm test` and
`pnpm benchmark:validate` all pass.

**Part G is blocked.** `STATEPROOF_ANTHROPIC_API_KEY` is not configured and no
`.env` exists, so `pnpm benchmark:smoke-model` and
`pnpm benchmark:baseline -- --split development` both exit 2 and write nothing.
No baseline metric exists, no strategic warning condition can be evaluated, and
`IMPROVEMENT_CHANGELOG.md` correctly still has no rows.

## Gates 3–5 — not started

No Contract Agent, Evidence Agent, Auditor, StateProof workflow, dashboard, or
locked evaluation has been implemented.
