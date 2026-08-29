# Limitations

What this project has and has not established. Read this before treating any
number elsewhere in the repository as a general claim.

## Scope of validation

- **Synthetic domain only.** Every result comes from a simulated
  refund-operations sandbox with four collections (`orders`, `refunds`,
  `emails`, `support_cases`) and three task templates. Nothing here establishes
  behaviour on a real payment system, CRM or ticketing platform.
- **The locked split has now been run, once.** Four held-out cases, after the
  source freeze, under a one-time protocol that makes a second attempt
  impossible. Both systems scored 100% on every quality metric, which means the
  suite **cannot separate them on accuracy** — it confirms StateProof did not
  degrade off the split it was built on, and nothing stronger. The honest claim
  is about cost and determinism at equal measured quality.
- **Twelve cases per suite.** A suite this size cannot separate small
  differences, and the locked result demonstrates that directly: both systems
  are perfect on all twelve. It was built to expose specific failure shapes,
  not to estimate a population rate or to rank two saturating systems.
- **One model family.** Every live run used the same provider and model. Nothing
  here says how a different model would compile these contracts.

## Known weaknesses in the implementation

- **The semantic lint's task-fact extraction is regex-based.** It reads the task
  text for an order id, a recipient, a "send" instruction and prior refund ids
  using patterns tuned to these templates. It is honest about what it checks,
  but a broader production domain needs typed task adapters rather than pattern
  matching. This is the single most domain-specific piece of the system.
- **The message policy is domain configuration.** `REFUND_OPS_MESSAGE_POLICY`
  names which message field carries which meaning. Another domain would need its
  own, and there is no general mechanism for deriving one.
- **The verifier is only as good as the contract.** Every quality defect across
  three iterations came from the contract language, not the verification engine.
  A contract that asks an under-specified question yields an honest
  `NEEDS_REVIEW`, which is safe but not useful — that is exactly what happened
  in v2 and cost three metrics at once.
- **No USD cost is claimed.** Token counts and wall-clock times are measured. No
  pricing rule is implemented, and inventing one would be a fabricated number in
  a project about not fabricating numbers.

## Preserved historical defects

Both of these are kept exactly as they were recorded. Rewriting a run's artifact
to look tidier is the habit this project exists to catch.

- **Gate 3A provenance defect.** The StateProof v1 cold run
  (`RUN-stateproof-hard-development-live-20260829T004039Z`) executed before its
  own source was committed, so its manifest records the previous HEAD and the
  prompt it names is not present at that commit. `pnpm check:provenance` fails
  on it by design, and the pinned registry marks it `known-defect` so that an
  unexpected change in either direction is an error. From Gate 3B onwards a live
  run refuses to start unless the tracked tree matches HEAD.
- **Gate 3C cosmetic stage label.** The v3 cold manifest
  (`RUN-stateproof-hard-development-cold-20260829T022133Z`) records
  `stage: "gate-3b-stateproof-development-cold"`. The label was left at the
  previous gate's value when the stage constant was not updated. It is
  **cosmetic**: every metric, hash, prompt reference, commit and path in that
  manifest is correct, and the run is fully re-derivable. The runner has been
  fixed forward (`gate-3c-stateproof-*`) with a regression test, and the
  historical artifact is untouched.

## Post-freeze changes

Exactly one tracked file changed after the evaluation freeze
(`c976e3838477afbf951d0faf57011be1b4ef6864`, tag
`stateproof-evaluation-freeze-v1`): an assertion in
`apps/dashboard/test/dashboard.test.ts` that hardcoded "8 inspector pages" was
made registry-driven, because the locked cases legitimately add four more. It
touches no prompt, no benchmark, no evaluator, no verifier and no scoring code,
and it cannot affect any measurement. Diff it against the freeze tag to confirm.

One cosmetic imprecision is preserved rather than patched: the locked StateProof
run printed `no efficiency claim: quality guardrails not met` to stdout because
no `--baseline-run` was supplied for that invocation, so no baseline was loaded
to compare against. The guardrails were in fact met; the run's own report says
"No baseline run was loaded", and `submission/final-evaluation.md` computes the
comparison correctly.

## Things deliberately not built

- **Evidence Agent.** The read-only evidence tool registry exists in the case
  fixtures, but verification currently reads the trajectory and both snapshots
  directly. An agent that plans evidence queries would add cost without adding
  measured value on this benchmark.
- **Auditor Agent and mutation generation.** Scoped out after the DSL work
  produced the same insight more cheaply.
- **A second locked evaluation.** The protocol refuses one, permanently.
- **Production concerns.** No authentication, no multi-tenancy, no billing, no
  real integrations, no autonomous writes.

## What would have to be true for this to be production-ready

1. Typed task adapters replacing regex task-fact extraction, per domain.
2. Contract compilation validated across more than three task templates.
3. A larger held-out suite: the current locked split is four cases and both
   systems saturate it.
4. Cost modelling, including a pricing rule and a per-run budget.
5. Evidence collection against real systems, with read-only guarantees enforced
   at the integration boundary rather than by convention.

None of these are done. **This is not a claim of production readiness.**
