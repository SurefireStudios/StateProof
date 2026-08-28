# StateProof — Persistent Claude Code Instructions (48-Hour Competition Scope)

## Mission

Build **StateProof**, an evidence-backed verifier for action-taking AI agents.

StateProof receives:

- The original task.
- The target agent's final response.
- A structured tool trajectory.
- Initial and final sandbox state.
- A registry of available read-only evidence tools.

It determines whether the task was actually completed and whether required process rules were followed. Every verdict must connect to concrete evidence.

Core thesis:

> For action-taking agents, the final answer is a claim, not evidence.

## Intended user and bottleneck

The intended users are AI product engineers, evaluation engineers, and operations teams deploying agents that modify business systems.

Their bottleneck is that a plausible final response or tool log can hide:

- No-op or phantom completion.
- Partial completion.
- Wrong-target actions.
- Incorrect amount, recipient, status, or other parameters.
- Required approval occurring after the protected action.
- Unrelated side effects.

## Fixed 48-hour scope

- Product name: `StateProof`.
- Benchmark name: `PhantomBench-12`.
- Primary demo: a simulated refund-operations workflow.
- Core benchmark: 12 manually reviewed cases.
- Optional stretch cases: no more than 2, and only after the core system is complete.
- Development/locked split: 8 development cases and 4 locked challenge cases.
- Primary metric: Balanced Verdict Accuracy.
- Baseline: one general-purpose evaluator agent with the same task, final response, trajectory, initial/final state, model family, and evaluation cases as StateProof.
- Final workflow: Contract Agent → Evidence Agent → deterministic verifier.
- Auditor Agent: one focused development-time mutation experiment, not a general autonomous framework.
- Build one polished Run Inspector and one Benchmark Comparison view.
- TypeScript-first implementation.
- Synthetic local data only.
- No real consequential integrations or actions.

## Non-goals

Do not add these unless explicitly approved after the core evaluation works:

- Production authentication.
- Billing.
- Multi-tenancy.
- Real Gmail, calendar, payment, CRM, or inventory integrations.
- Autonomous real-world writes.
- Multiple industry sandboxes.
- A decorative multi-agent swarm.
- Multiple model providers before one provider and replay mode work.
- A vector database or long-term memory.
- A generalized agent framework.
- UI polish before the evaluation CLI is stable.
- More than 12 core cases before every core case validates and runs.

## Canonical benchmark source

The repository must include the approved `PhantomBench-12` case matrix. Claude may translate it into fixtures but must not silently change the task requirements, gold verdict, isolated failure, or split.

Every invalid fixture should normally violate one must-pass requirement only. Any deliberate multi-fault case must be labeled as such in human-only metadata and excluded unless explicitly approved.

## Evaluation integrity rules

These rules are non-negotiable:

1. Baseline and StateProof use the same underlying cases.
2. Freeze the baseline prompt before tuning StateProof.
3. Gold contracts, labels, failure descriptions, and split metadata are never passed to agents.
4. The Contract Agent compiles the task contract before seeing the evaluated trajectory, final state, final response, or gold data.
5. The four locked challenge cases are not used for prompt tuning before the final locked comparison.
6. Every fixture must pass deterministic schema and semantic validation.
7. Every invalid fixture must be validated against its intended gold failure.
8. Every run stores model/provider ID, prompt hashes, dataset hash, commit SHA, timing, token usage, estimated cost, and retry count when available.
9. Headline metrics are generated from raw artifacts and never hardcoded.
10. Missing evidence must not become `PASS`; use `NEEDS_REVIEW`.
11. Store raw model responses and representative trajectories for every agent.
12. Replay mode must reproduce deterministic scoring without an API key.

## Core architecture

### Contract Agent

Input:

- Original task.
- Tool definitions.
- Domain/state schema.

Must not see:

- Target trajectory.
- Initial/final evaluated state.
- Target final response.
- Gold contract or verdict.

Output:

- Stable requirement IDs.
- Requirement category: `outcome`, `process`, `scope`, `prohibition`, or `quality`.
- Human-readable description.
- Machine-checkable assertion when possible.
- Required evidence source/strategy.
- Severity and must-pass status.
- Explicit ambiguities.

### Evidence Agent

Input:

- Compiled contract.
- Target trajectory.
- Initial and final state.
- Read-only evidence tool registry.

Output:

- Minimal evidence plan.
- Validated read-only tool calls or direct evidence queries.
- Evidence records linked to requirement IDs.
- Missing and contradictory evidence markers.

The Evidence Agent must never invoke a write-capable tool.

### Deterministic verifier

Use code for objective checks, including the assertion types required by the core benchmark:

- Equality.
- Existence or absence.
- Exact numeric values.
- Exact recipient matching.
- Event ordering.
- Required note/status existence.
- No new record creation when prohibited.
- No unrelated mutations.

Overall verdicts:

- `PASS`: every must-pass requirement is verified.
- `FAIL`: at least one must-pass requirement is disproven.
- `NEEDS_REVIEW`: none is disproven, but at least one lacks enough evidence.

### Auditor Agent

Use only during development to:

- Propose one plausible single-fault mutation.
- Explain which requirement it should violate.
- Explain why a weak verifier might miss it.
- Recommend the smallest missing assertion or evidence source.

A deterministic mutation function must apply and validate an approved mutation. The Auditor does not assign the final production verdict.

## Safety and data rules

- Use synthetic data only.
- Keep all writes inside the local sandbox.
- Represent human approval as a scoped trace event before the protected action.
- StateProof evidence tools must be read-only.
- Never commit credentials, personal data, or private customer information.
- Provide `.env.example` without values.
- Make all fixtures, traces, and logs safe to share.

## Engineering standards

- TypeScript strict mode.
- Avoid `any`.
- Validate all external/model data with Zod.
- Prefer small, testable modules and explicit interfaces.
- Separate model interpretation from deterministic scoring.
- Store prompts in versioned files.
- Hash prompt files in run manifests.
- Use seeded IDs and timestamps for fixtures.
- Keep captured-response replay deterministic.
- Unit-test schemas, assertions, state diffs, scoring, and gold isolation.
- Integration-test one valid and one invalid end-to-end case.
- Keep dependency count reasonable.
- Do not add an orchestration framework unless it clearly simplifies the implementation.
- Pin runtime and dependency versions before submission.
- Document non-obvious decisions under `docs/decisions/`.

## Suggested repository shape

```text
stateproof/
├── apps/
│   └── web/
├── packages/
│   ├── core/
│   ├── agents/
│   ├── sandbox/
│   ├── benchmark/
│   └── model-provider/
├── benchmarks/
│   └── phantombench-12/
│       ├── cases/
│       ├── splits/
│       ├── schemas/
│       └── CASE_MATRIX.md
├── prompts/
├── scripts/
├── docs/
├── artifacts/
│   ├── model-responses/
│   ├── reports/
│   ├── run-manifests/
│   └── trajectories/
├── PREEXISTING_WORK.md
├── IMPROVEMENT_CHANGELOG.md
├── REPRODUCTION.md
└── README.md
```

The layout may be simplified when that materially improves reliability. Preserve the conceptual boundaries.

## Required command contract

The finished repository should expose commands equivalent to:

```bash
pnpm typecheck
pnpm test
pnpm benchmark:validate
pnpm benchmark:baseline
pnpm benchmark:stateproof
pnpm benchmark:report
pnpm reproduce
pnpm run:live
pnpm dev
```

- `pnpm reproduce` must work without an API key by using submitted captured responses and trajectories.
- `pnpm run:live` may require one configured provider key and must document expected variability, runtime, and cost.

## Required run artifacts

Every evaluation run must produce:

- Run manifest.
- Raw model responses.
- Agent trajectories.
- Per-case predictions.
- Per-requirement verdicts.
- Aggregate metrics.
- Runtime and cost summary.
- Human-readable report.

## Required final documentation

- `README.md`
- `PREEXISTING_WORK.md`
- `IMPROVEMENT_CHANGELOG.md`
- `REPRODUCTION.md`
- `docs/project-brief.md`
- `docs/evaluation-plan.md`
- `docs/architecture.md`
- `docs/limitations.md`
- `docs/claims-evidence-map.md`
- `docs/agent-prompts.md`
- Representative trajectories for every agent used.

## Working method

Work one bounded phase at a time.

Before editing:

1. Inspect the repository.
2. Restate the active phase and acceptance criteria.
3. Provide a concise implementation plan.
4. Identify assumptions or blockers.

After editing:

1. Run every command required by the phase.
2. Fix failures rather than merely reporting them.
3. Show a useful directory tree.
4. Summarize changed files.
5. Report exact command results.
6. List assumptions and deferred items.
7. Stop at the phase boundary.

Do not continue into the next phase until the human owner explicitly asks.

## Scope priority

When time is tight, prioritize in this exact order:

1. Correct benchmark fixtures.
2. Fair baseline.
3. StateProof requirement and evidence pipeline.
4. Deterministic scoring.
5. Reproducible artifacts.
6. Clear judge-facing interface.
7. Visual polish.
8. Optional stretch cases or features.
