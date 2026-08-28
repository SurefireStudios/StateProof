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

## Gate 2 — not started

Needs: the remaining 11 cases (`PB-A01`, `PB-A02`, `PB-A04`, `PB-B01`–`PB-B04`,
`PB-C01`–`PB-C04`), a support-cases collection and note assertions for
templates B and C, split population to 8/4, gold balance checks, the frozen
baseline prompt, a model provider client with replay, and the baseline runner.

Nothing in gates 2–5 has been started.
