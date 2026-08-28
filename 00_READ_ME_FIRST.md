# StateProof 48-Hour Parallel Build Pack

This pack divides work between ChatGPT and Claude Code so the project can move forward on two tracks without duplicating effort.

## Immediate sequence

1. Copy `01_CLAUDE_48H.md` into the repository root as `CLAUDE.md`.
2. Paste `02_CLAUDE_KICKOFF_48H.md` into Claude Code.
3. Let Claude complete only the foundation phase and stop at the stated gate.
4. Use the benchmark, scoring, and prompt specifications in this pack as the canonical product requirements.
5. Bring Claude's directory tree, schema files, and command output back to ChatGPT for review before Phase 2.

## Canonical division of responsibility

### Claude Code owns implementation

- Repository scaffold and package setup.
- TypeScript and Zod schemas.
- Benchmark loaders and validators.
- Sandbox state and trajectory engine.
- Baseline runner.
- Contract Agent and Evidence Agent integration.
- Deterministic assertion engine.
- Tests, CLI commands, report generation, and UI implementation.

### ChatGPT owns product truth and submission rigor

- Scope control and competition strategy.
- Benchmark case design and gold requirements.
- Evaluation methodology and metric definitions.
- Agent prompt specifications.
- Fair-baseline rules.
- Improvement experiment design and changelog structure.
- Code/output review, QA findings, and corrective Claude prompts.
- README, reproduction, limitations, claims-to-evidence mapping, and final presentation narrative.

### The human owner controls the gates

- Runs Claude Code and local commands.
- Approves scope decisions.
- Supplies model credentials locally without committing them.
- Shares Claude's output and errors with ChatGPT.
- Stops Claude at each phase boundary until the prior gate is reviewed.

## Files in this pack

- `01_CLAUDE_48H.md` — persistent repository instructions for the compressed build.
- `02_CLAUDE_KICKOFF_48H.md` — first implementation prompt for Claude Code.
- `03_PARALLEL_WORK_PLAN.md` — exact division of labor and checkpoints.
- `04_PHANTOMBENCH_12_CASE_MATRIX.md` — canonical core benchmark design.
- `05_EVALUATION_AND_SCORING_SPEC.md` — metrics, fairness, and run protocol.
- `06_AGENT_PROMPT_PACK.md` — baseline, Contract Agent, Evidence Agent, and Auditor prompts.
- `07_REVIEW_GATE_CHECKLIST.md` — what must be reviewed before advancing.

## Scope rule

The 48-hour version is a focused competition submission, not a production SaaS. Build the proof first, then build the interface around the proof.
