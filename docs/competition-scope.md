# Competition scope

Canonical source: `01_CLAUDE_48H.md` (copied to `CLAUDE.md`). This document
restates the boundary in the terms the code is organised around.

## Fixed scope

| Decision | Value |
| --- | --- |
| Product | StateProof |
| Benchmark | PhantomBench-12 |
| Demo domain | Simulated refund operations |
| Core cases | 12, manually reviewed |
| Split | 8 development / 4 locked challenge |
| Gold balance | 6 PASS / 6 FAIL |
| Primary metric | Balanced Verdict Accuracy |
| Baseline | One general-purpose evaluator agent, same inputs and model family |
| Final workflow | Contract Agent → Evidence Agent → deterministic verifier |
| Auditor | One focused mutation experiment, not a general framework |
| Interface | One Run Inspector, one Benchmark Comparison view |
| Implementation | TypeScript-first, strict mode, Zod at every boundary |
| Data | Synthetic and local only |

Stretch cases (`PB-S01`, `PB-S02`): at most two, and only after all twelve core
cases validate, the baseline runs, and StateProof produces a comparison report.

## Non-goals

Not to be added unless explicitly approved after the core evaluation works:
production authentication, billing, multi-tenancy, real Gmail/calendar/payment/
CRM/inventory integrations, autonomous real-world writes, multiple industry
sandboxes, a decorative multi-agent swarm, multiple model providers before one
provider plus replay works, a vector database or long-term memory, a
generalised agent framework, UI polish before the evaluation CLI is stable, or
more than 12 core cases before every core case validates and runs.

## Scope priority when time is tight

1. Correct benchmark fixtures.
2. Fair baseline.
3. StateProof requirement and evidence pipeline.
4. Deterministic scoring.
5. Reproducible artifacts.
6. Clear judge-facing interface.
7. Visual polish.
8. Optional stretch cases or features.

## Gates

Work advances one gate at a time, and only when the human owner asks.

| Gate | Content | Status |
| --- | --- | --- |
| 1 | Foundation, schemas, loader/validator, one sample case | **Complete** |
| 2 | All 12 PhantomBench cases + fair baseline runner | Not started |
| 3 | Contract Agent, Evidence Agent, StateProof workflow | Not started |
| 4 | Mutation/Auditor improvement experiment + interface | Not started |
| 5 | Locked run, reproduction, freeze, submission docs | Not started |

## What gate 1 deliberately did not build

No web application. No model provider client. No baseline runner. No Contract
Agent or Evidence Agent. No metric computation. No prompt files. No run
artifacts.

Later commands (`benchmark:baseline`, `benchmark:stateproof`,
`benchmark:report`, `reproduce`, `run:live`, `dev`) are absent rather than
stubbed, so that nothing can report a success it did not achieve.

## Safety rules that constrain the code

- Synthetic data only; every writable action stays inside the local sandbox.
- Human approval is represented as a scoped trace event preceding the
  protected action, never as a sandbox write.
- StateProof evidence tools are read-only; the tool registry marks each tool
  `read` or `write` and the Evidence Agent may never invoke a `write` tool.
- No credentials, personal data, or private customer information is committed.
  `.env.example` carries names only, no values.
- Every fixture, trace and log in this repository is safe to share.
