# Roadmap

What StateProof has established is narrow and stated plainly in
[limitations.md](limitations.md): on twelve synthetic refund-operations cases,
compiling the task into a contract once and verifying deterministically matched
a frontier evaluator's quality at a fraction of the model cost, with citations
that cannot be invented. Everything below is about widening that without
weakening it.

Each item is tracked as a GitHub issue labelled
[`roadmap`](https://github.com/SurefireStudios/StateProof/issues?q=is%3Aissue+is%3Aopen+label%3Aroadmap).
Order within a section is rough priority. Nothing here is a commitment to a
date.

## Now — make the engine reusable outside the benchmark

- **Typed task adapters.** Replace the regex task-fact extraction in the
  semantic lint with per-domain adapters that produce typed facts. This is the
  single most domain-specific piece of the system today.
- **A standalone verification CLI.** `stateproof verify <run-package.zip>`
  producing the same evidence pack the product exports, for use in CI and in
  agent evaluation pipelines.
- **Trajectory ingestion adapters.** Convert common trace formats (OpenTelemetry
  spans, framework-native tool logs) into the gap-free `seq`-ordered trajectory
  StateProof verifies against.
- **Publish `@stateproof/core`.** The schemas, assertion DSL, evaluator, state
  diff and evidence references as an installable package.

## Next — widen the evidence base

- **A second sandbox domain.** Ticketing or CRM, with its own message policy and
  task templates, to test whether the contract vocabulary transfers.
- **A larger held-out suite.** The locked split is four cases and both systems
  saturate it. A new suite needs a new freeze protocol and a new one-time locked
  run; the current one cannot be repeated by design.
- **Evidence Agent.** Read-only evidence planning against the tool registry, for
  cases where the trajectory and snapshots alone are not enough. Must never
  invoke a write-capable tool; the boundary is enforced in code.
- **Read-only evidence adapters for real systems.** Payment providers in test
  mode, ticketing APIs, databases, with the read-only guarantee enforced at the
  integration boundary rather than by convention.

## Later — hardening and operations

- **Auditor Agent.** Development-time single-fault mutation proposals with a
  deterministic mutation function, to find assertions the contract is missing.
- **Cost modelling.** A pricing rule per provider and a per-run budget, so the
  "model tokens to verify" metric can be reported as spend with provenance.
- **A second model family** for contract compilation, to measure how much of
  the result depends on the provider.
- **Opt-in persistence and sharing** in the product: durable run storage and
  shareable evidence packs, behind authentication.

## Not planned

- Autonomous execution or approval of consequential actions. StateProof verifies;
  a qualified human decides.
- A general agent framework or orchestration layer.
- Re-running the completed locked evaluation. The protocol refuses it, and the
  refusal is the point.
