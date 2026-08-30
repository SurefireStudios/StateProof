# Pre-existing work

## Summary

**None.** Every source file, schema, fixture, prompt, test, dashboard page and
artifact in this repository was produced during the competition window. The only files not written as
implementation are the supplied specification documents listed below.

## Starting state

At the start of the foundation gate the repository contained specification
documents only — no source code, no package manifest, no git history, and no
prior StateProof implementation, public or private. These are working planning
notes, held locally and not committed:

- `00_READ_ME_FIRST.md` — build pack overview and division of labour.
- `01_CLAUDE_48H.md` — persistent scope and standards. Held locally as the
  agent's standing instruction file; not published, because it is an input to
  the build rather than part of what the submission delivers.
- `02_CLAUDE_KICKOFF_48H.md` — foundation gate specification.
- `03_PARALLEL_WORK_PLAN.md` — checkpoints.
- `04_PHANTOMBENCH_12_CASE_MATRIX.md` — **canonical** benchmark design.
- `05_EVALUATION_AND_SCORING_SPEC.md` — metrics, fairness rules, run protocol.
- `06_AGENT_PROMPT_PACK.md` — prompt specifications for later phases.
- `07_REVIEW_GATE_CHECKLIST.md` — gate review checklist.

Benchmark case design, gold requirements, metric definitions, and prompt
specifications originate in those documents, not in the implementation. The
implementation translates them into schemas, fixtures and code.

## Third-party dependencies

Only these packages are used. Each is a widely used, unmodified release from
the public npm registry, pinned to an exact version:

| Package       | Version  | Why it is here                                          |
| ------------- | -------- | ------------------------------------------------------- |
| `zod`         | 3.23.8   | Runtime validation of every external and model-produced value. |
| `typescript`  | 5.4.5    | Strict-mode type checking.                              |
| `vitest`      | 1.6.0    | Test runner.                                            |
| `tsx`         | 4.19.2   | Runs the TypeScript validation CLI without a build step. |
| `@types/node` | 20.14.10 | Node type definitions.                                  |

No agent framework, orchestration library, evaluation harness, or third-party
benchmark dataset was reused. The `PhantomBench-12` fixtures are authored here
from the canonical case matrix.

## Ideas that are not original

The problem framing draws on published work on agent evaluation and process
supervision generally; no specific implementation, prompt, or dataset was
copied. The refund-operations scenario, the fixture format, the assertion
vocabulary, and the verdict semantics are original to this project.
