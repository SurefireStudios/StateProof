# Agent prompts

Five frozen prompts, five model-driven roles. Each file is hashed into every
artifact it produced, so a run can always be traced to the exact prompt text
behind it. Changing one byte changes the hash, invalidates every cached contract
and breaks comparability with earlier runs — which is the point.

| Id | File | sha256 (first 16) | Used by |
| --- | --- | --- | --- |
| `baseline-evaluator-v1` | `prompts/baseline-evaluator/v1.md` | `c2bcb3f7adb43e6c` | Core-12 diagnostic baseline |
| `baseline-evaluator-v2` | `prompts/baseline-evaluator/v2.md` | `d5a03c05b36d9b68` | Frozen frontier baseline (Hard-12) |
| `contract-agent-v1` | `prompts/contract-agent/v1.md` | `fea2ee3fa5d9d588` | StateProof v1 cold |
| `contract-agent-v2` | `prompts/contract-agent/v2.md` | `880e3e23b6c3557b` | StateProof v2 cold |
| `contract-agent-v3` | `prompts/contract-agent/v3.md` | `b3b93c18b63f2794` | StateProof v3 cold and warm |

Full text is in the repository, and the dashboard's **Trajectories** page renders
each prompt beside the exact input envelope, the raw response, the parsed output
and the validation result.

## What each prompt is allowed to see

### Baseline evaluator (v1, v2)

Task instruction, final response, trajectory, initial and final state,
descriptions of the read-only evidence sources. Never a case id, a split label,
a requirement id, a gold contract or the case matrix.

The baseline is the fairness control: same inputs, same model, same cases, same
single repair retry. v2 was frozen before StateProof was built and has not been
re-run since.

### Contract Agent (v1, v2, v3)

Task instruction, tool definitions, domain schema, assertion vocabulary,
requirement-key vocabulary. **Nothing about any run** — no trajectory, no state,
no final response, no case id, no split, no gold data.

That restriction is what makes a compiled contract a contract. A contract
written after seeing the run is a description of what happened.

## Why there are three Contract Agent versions

Each version exists because the previous one produced a measured defect. None
was tuned after seeing its own result.

- **v1** — the first compile-once contract. Could not express "only the support
  case for *this* order may change" (the task never names the case), and added a
  scope clause over refunds that double-counted a prohibited refund.
- **v2** — added relational mutation scope (`mutations_limited_to`), required one
  note to carry both its exact text and its refund reference, forbade duplicating
  a prohibition into scope, and introduced declared verification coverage. Fixed
  all three v1 defects; introduced one — outbound messages identified by
  recipient alone, which a pre-existing message to the same person made
  unresolvable.
- **v3** — outbound records are existential (`record_exists_matching`), exact-one
  selectors are reserved for source entities, and unstated prose is explicitly
  not a coverage gap. Met every guardrail with zero repair retries.

## The deterministic verifier is not an agent

The step that produces every verdict has no model in it. It evaluates the
compiled contract's assertions against the trajectory and both snapshots and
builds each evidence reference from what those assertions matched. The
Trajectories page labels it as code for exactly this reason: it would be
misleading to present it alongside the model roles without saying so.

## Prompt-adjacent machinery

- **Structured output with one repair retry** —
  `packages/model-provider/src/structured.ts`. The baseline and the Contract
  Agent get exactly one correction each, so the comparison stays fair.
- **Semantic validation shares that budget.** A schema-valid but unusable
  contract is sent back with the exact defects; a twice-invalid response writes
  no contract artifact and no cache entry.
- **Every attempt is persisted.** `artifacts/model-responses/<runId>/` holds the
  system prompt, the full input envelope, the raw response, the stop reason,
  token usage and the validation error for every attempt — including rejected
  ones, which is where the repair behaviour is actually visible.

## Credentials

No prompt file, artifact, manifest or rendered page contains a credential. The
model client reads `STATEPROOF_ANTHROPIC_API_KEY` from the environment at
construction and never records it. See `docs/security-and-data.md`.
