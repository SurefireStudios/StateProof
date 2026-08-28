# StateProof Parallel Work Plan

## Goal

Produce a competition-ready StateProof submission within 24–48 hours by separating implementation from evaluation design and reviewing the project at explicit gates.

## Workstream A — Claude Code

Claude should focus on code that can be executed, tested, and reproduced.

### Phase A1: Foundation

Claude delivers:

- pnpm TypeScript workspace.
- Strict TypeScript and Zod schemas.
- Benchmark fixture loader with gold-data isolation.
- Deterministic trace-order assertion.
- One complete sample fixture.
- Tests and three passing commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm benchmark:validate`

Claude must stop after this phase.

### Phase A2: Core benchmark and baseline

After ChatGPT reviews the schemas, Claude delivers:

- Twelve core benchmark fixtures based on the approved matrix.
- Baseline evaluator runner.
- Raw response capture.
- Per-case result artifacts.
- Aggregate baseline report.

### Phase A3: StateProof workflow

Claude delivers:

- Contract Agent integration.
- Evidence Agent integration.
- Deterministic verifier.
- Requirement-level verdict report.
- Replayable agent trajectories.
- Complete comparison report.

### Phase A4: Auditor and interface

Claude delivers:

- One controlled adversarial mutation workflow.
- One regression fixture created from an escaped or deliberately challenged failure.
- Run Inspector screen.
- Benchmark Comparison screen.
- Replay mode.

### Phase A5: Reproduction and freeze

Claude delivers:

- Clean install and command contract.
- Reproduction scripts.
- Pinned versions.
- No-secret validation.
- Final repository tree and command output.

---

## Workstream B — ChatGPT

ChatGPT owns the parts that should not drift while Claude is coding.

### B1: Canonical product and benchmark specification

- Keep the 48-hour scope locked.
- Define the intended user and bottleneck.
- Define the exact benchmark cases and gold requirements.
- Ensure invalid cases are plausible, isolated, and measurable.
- Protect against benchmark leakage.

### B2: Evaluation design

- Define Balanced Verdict Accuracy.
- Define unsafe false-completion rate.
- Define valid-run acceptance.
- Define how `NEEDS_REVIEW` is scored.
- Define fairness between baseline and final solution.
- Define run metadata and evidence requirements.

### B3: Prompt design

- Write and revise the baseline evaluator prompt.
- Write the Contract Agent prompt.
- Write the Evidence Agent prompt.
- Write the Auditor prompt.
- Keep prompts versioned and schema-constrained.

### B4: Review and corrective handoffs

At every Claude checkpoint, ChatGPT will review:

- Architecture and unnecessary scope.
- Schema quality and leakage risk.
- Benchmark consistency.
- Assertion correctness.
- Prompt-to-schema alignment.
- Result validity.
- UI clarity and judge-facing story.

ChatGPT will then produce the next bounded Claude Code prompt.

### B5: Submission package

ChatGPT will draft and refine:

- Project brief.
- Evaluation plan.
- Improvement changelog.
- README narrative.
- Reproduction guide.
- Architecture explanation.
- Limitations.
- Claims-to-evidence map.
- Final demo script and video storyboard after the code is frozen.

---

## Workstream C — Human project owner

The project owner is the integration point.

- Create the repository.
- Run Claude Code.
- Keep credentials local.
- Execute commands and share exact output.
- Prevent Claude from advancing beyond the current phase.
- Make final product and design calls.
- Commit after each reviewed gate.

---

# Parallel timeline

## Hours 0–4

### Claude

Builds the repository foundation, schemas, loader, validator, and one sample approval-order fixture.

### ChatGPT

Finalizes:

- PhantomBench-12 matrix.
- Metric and fairness specification.
- Versioned agent prompt pack.
- Review gate checklist.

### Gate 1 output needed from Claude

- Directory tree.
- Schema source files.
- Sample fixture files.
- `pnpm typecheck` output.
- `pnpm test` output.
- `pnpm benchmark:validate` output.

## Hours 4–10

### Claude

Implements the twelve fixtures and baseline runner after Gate 1 approval.

### ChatGPT

- Audits every case against the canonical matrix.
- Checks gold isolation.
- Reviews baseline prompt implementation.
- Defines the first improvement-changelog entry.

### Gate 2 output needed from Claude

- Per-case baseline predictions.
- Raw baseline responses.
- Aggregate metrics.
- Runtime and token/cost summary.
- Any parsing failures or retries.

## Hours 10–20

### Claude

Implements Contract Agent, Evidence Agent, and deterministic verifier.

### ChatGPT

- Audits prompts and requirement coverage.
- Reviews escaped failures.
- Determines the smallest evidence or assertion improvements.
- Produces bounded correction prompts.

### Gate 3 output needed from Claude

- Compiled contracts.
- Evidence records.
- Requirement-level verdicts.
- Aggregate StateProof metrics.
- Baseline-versus-final report.
- Representative trajectories.

## Hours 20–30

### Claude

Adds one mutation/auditor experiment and the judge-facing interface.

### ChatGPT

- Turns the real experiment results into the improvement changelog.
- Designs the dashboard information hierarchy and copy.
- Audits whether every claim is backed by an artifact.

## Hours 30–40

### Claude

Finishes replay, reports, and reproduction commands.

### ChatGPT

Drafts submission documentation and limitations from actual results.

## Hours 40–48

- Clean-environment test.
- Final red-team review.
- UI polish.
- Repository freeze.
- Video and submission preparation.

---

# Anti-duplication rules

1. Claude does not invent benchmark truth. It implements the approved matrix.
2. ChatGPT does not claim code works without Claude command output.
3. Claude does not write final result claims before evaluation artifacts exist.
4. ChatGPT does not rewrite metrics manually; it uses generated reports.
5. The human owner does not let both systems independently redesign the schemas after Gate 1.
6. Every phase ends with a review before the next phase starts.
