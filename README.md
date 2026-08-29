# StateProof

> **The agent said it was done. Prove it.**

StateProof compiles success criteria once, then verifies every agent run against
actual state and event evidence—without asking another model to judge the same
workflow again.

Given a task, the agent's final response, its tool trajectory, and the initial
and final sandbox state, it decides whether the work was actually done — and ties
every part of that verdict to a concrete observation.

---

## 1. The pitch

An agent reports: *"Approval was obtained before the refund. I refunded exactly
40.00 USD, emailed the receipt, and added the note to SUP-2077."* Every tool call
in the run returned `ok`.

The refund executed for **55.00**. The note was **never written**. The approval is
at `seq 12`; `refund.execute` is at `seq 8` — the money moved first.

StateProof reports all three in about a millisecond, with a citation into the
record or event that proves each one, and without calling a model.

## 2. Who has this problem

AI product engineers, evaluation engineers and operations teams deploying agents
that **modify business systems**: refunds, tickets, CRM records, inventory,
scheduling. The moment an agent writes rather than reads, "did it work?" stops
being a question about text quality.

## 3. The bottleneck

A confident final response and a clean-looking tool log can both be present while
the work is wrong. Six failure shapes hide behind them:

- no-op or phantom completion;
- partial completion;
- wrong-target action;
- wrong amount, recipient or status;
- an approval recorded **after** the protected action;
- unrelated side effects.

Checking by hand means reading the summary, skimming the log, and opening the
database. It is slow, it does not scale, and the failure that hurts most — an
approval that arrived too late — is invisible in both the summary and the log,
because the call can carry an `approvalReference` argument regardless.

## 4. What the product looks like

No screenshots are embedded here — nothing in this repository is a mock-up, and a
still image of a page you can run in thirty seconds would be the only unverified
thing in the submission. Run it (§5); these are the screens you will see.

| Route | What is on it |
| --- | --- |
| `/#/` | **Home.** A worked example across the top: what was asked, what the agent reported, and what the verifier found in the state. Generated on request by the frozen verifier — the claim is the run's own final response, the findings are the verifier's own evidence strings. Below it, the measured result and the scope limitation. |
| `/#/demo` | **Demo.** `PBH-B03`: the task, the agent's completion claim, and a **Verify this run** button. |
| `/#/runs/<id>` | **Run inspector.** Verdict · Requirements · Timeline · State diff · Evidence · Contract · Export, with in-page navigation. Every evidence reference is a link that scrolls to the exact event, record or diff row it names. |
| `/#/import` | **Import.** A run-package ZIP or individual files, the supported manifest, field-specific validation errors, an explicit verify step, and JSON/Markdown evidence export. A sample package is one click away. |
| `/#/benchmark` | **Benchmark.** Development, locked and combined results; baseline, cold StateProof and warm StateProof; calls, tokens, wall time, deterministic verification time, evidence-reference validity, and what the result does not show. |
| `/dashboard/` | **The static evidence dashboard**, served by the same process: every run, prompt, raw response and report behind the numbers. |

## 5. Interactive quick start

```bash
pnpm install
pnpm product:build
pnpm product:dev
```

Open <http://localhost:4180/>, click **Run the verification demo**, then **Verify
this run**. No API key, no model call, no network.

Full walkthrough: [`docs/judge-quick-start.md`](docs/judge-quick-start.md).

## 6. How StateProof works

1. **Compile the contract once.** A Contract Agent turns the task into typed,
   machine-checkable requirements — before it has seen the trajectory, the state,
   or the agent's answer.
2. **Cache it by task fingerprint.** The key covers task text, tools, domain
   schema, assertion vocabulary, prompt and model configuration.
3. **Verify deterministically.** Code evaluates the contract against the
   trajectory and both state snapshots. No model is in the loop.
4. **Cite evidence that exists.** Every reference is generated from the records
   and events the assertions actually matched.

Verdicts are `PASS`, `FAIL`, or `NEEDS_REVIEW`. Missing evidence never becomes
`PASS`.

## 7. Why each component exists

| Component | Why it is there |
| --- | --- |
| Contract Agent | Interpreting a natural-language task is the one genuinely model-shaped step. It runs once per task, never per run. |
| Task fingerprint + contract bundle | Makes the compiled contract a durable, auditable artifact, so repeat verification costs nothing. |
| Deterministic verifier | Same inputs, same verdict, every time — and no per-run model cost. |
| Assertion DSL | Forces a requirement into a checkable form, which is what surfaced every defect the changelog records. |
| Semantic lint | Catches contracts that are schema-valid but unusable: invented ids, under-specified selectors, contradictory coverage claims. |
| Gold-isolation package boundary | The prediction phase cannot import gold data; predictions are on disk before the scorer opens its first gold file. |
| One-time locked protocol | Makes the held-out evaluation unrepeatable, so it stays held out. |

## 8. The fair baseline

One general-purpose frontier evaluator, given the **same** task, final response,
trajectory, both state snapshots, model, configuration and single repair retry.
Its prompt ([`prompts/baseline-evaluator/v2.md`](prompts/baseline-evaluator/v2.md))
was frozen before StateProof was built and has never been tuned since.

## 9. Evaluation protocol

- **Two benchmarks.** `PhantomBench-12` (Core-12) is the diagnostic suite that
  established the harness. `PhantomBench-Hard-12` is the final benchmark, scored
  at requirement level.
- **Two splits.** Eight development cases, iterated against. Four locked cases,
  held out, evaluated **exactly once** after a source freeze
  (`stateproof-evaluation-freeze-v1` → `c976e3838477afbf951d0faf57011be1b4ef6864`)
  under a one-time protocol recorded in an append-only ledger.
- **Gold isolation as a package boundary.** `@stateproof/benchmark` cannot reach
  gold data; only `@stateproof/benchmark/gold` can, and the prediction phase
  never imports it.
- **Metrics recomputed from counts**, never averaged from percentages.
- **Efficiency withheld in code** unless SVR 100%, CDR 100%, FVR 0% and
  evidence-reference validity 100% all hold on both the locked and combined
  results. Two earlier iterations were cheaper than the baseline and are reported
  with no reduction figures at all.

Detail: [`docs/evaluation-plan.md`](docs/evaluation-plan.md).

## 10. Final results

> On 12 synthetic benchmark cases, StateProof matched the frontier baseline's
> perfect requirement-level diagnosis while reducing first-deployment model calls
> by 75%, model tokens by 76.1%, and repeated verification to zero model calls
> and zero model tokens.

> This evaluation does not establish universal generalization. It shows that
> StateProof preserved measured quality on four untouched held-out cases while
> making repeated verification deterministic, reproducible, and substantially
> more efficient.

**Combined, all 12 cases** — recomputed from counts:

| Metric | Frontier baseline | StateProof v3 |
| --- | --- | --- |
| Safety Violation Recall | 100% (18/18) | 100% (18/18) |
| False Violation Rate | 0% (0/34) | 0% (0/34) |
| Complete Diagnosis Rate | 100% (6/6) | 100% (6/6) |
| Balanced Verdict Accuracy | 100% | 100% |
| Assessment completeness | 100% (52/52) | 100% (52/52) |
| Evidence-reference validity | 99.5% (205/206) | **100% (116/116)** |

**Untouched locked split, 4 cases, run once:**

| Metric | Frontier baseline | StateProof v3 |
| --- | --- | --- |
| SVR / FVR / CDR / BVA | 100% / 0% / 100% / 100% | 100% / 0% / 100% / 100% |
| Evidence-reference validity | 98.5% (64/65) | **100% (36/36)** |
| Model calls / tokens | 4 / 40,538 | **0 / 0** |

The StateProof locked run used the frozen contract bundle with **no credential in
its environment**: all four locked tasks resolved to contracts compiled during
development, so nothing was recompiled and no model was called.

**Model usage over all 12:**

| | Frontier baseline | StateProof cold (first deployment) | StateProof warm (repeated) |
| --- | --- | --- | --- |
| Model calls | 12 | 3 | **0** |
| Total tokens | 125,154 | 29,889 | **0** |
| Model-call wall time | not isolated | 53.3 s | 0 ms |
| Deterministic verification | — | 143 ms | 133 ms |
| End-to-end elapsed | 157.0 s | 53.8 s | 587 ms |
| API cost estimate | $0.91 | $0.26 | **$0.00** |

Break-even is one run of the suite. USD figures are an estimate against a dated,
sourced price list ([`submission/final-pricing-manifest.json`](submission/final-pricing-manifest.json)),
not an invoice.

One difference worth naming: on the locked split the baseline cited one evidence
reference that does not resolve to any real event or record. StateProof cannot do
that — its references are generated from what the assertions matched.

Full result: [`submission/final-evaluation.md`](submission/final-evaluation.md).
Claims → evidence: [`submission/final-claims-evidence-map.md`](submission/final-claims-evidence-map.md).

## 11. Improvement changelog

Core-12 saturated. Hard-12 saturated. StateProof **v1** got every overall verdict
right but could not express "only the support case for *this* order may change",
and double-counted a prohibited refund as a scope failure. **v2** fixed all three
and introduced one of its own: outbound messages identified by recipient alone,
which a pre-existing message to the same person made unresolvable — the verifier
correctly withheld a verdict, and the warm run was withheld with it. **v3** added
existential matching and a lint that refuses under-specified output selectors,
met every guardrail, and earned the efficiency claim. Then the locked split was
run once, and held. Finally the engine was wrapped in an interactive product.

Every failed iteration is preserved with its report, manifest and prompt:
[`IMPROVEMENT_CHANGELOG.md`](IMPROVEMENT_CHANGELOG.md).

## 12. Reproduction

```bash
pnpm install
pnpm reproduce
```

No API credential is required, read, or accepted. It re-verifies all twelve Hard
cases from the committed contract bundle, compares canonical predictions to the
submitted hashes, recomputes development, locked and combined metrics, and prints
`RESULT: PASSED (26 checks)`.

Everything at once:

```bash
pnpm final:verify
```

See [`REPRODUCTION.md`](REPRODUCTION.md) and
[`submission/clean-reproduction-report.md`](submission/clean-reproduction-report.md).

## 13. Security and data

- Synthetic data only. All writes stay inside the local sandbox. No consequential
  integration exists.
- Evidence tools are read-only; the product performs no write of any kind.
- `.env` is git-ignored; `.env.example` carries empty placeholders only.
- The only credential variable ever read is `STATEPROOF_ANTHROPIC_API_KEY`.
  `ANTHROPIC_API_KEY` is never read, and a test asserts no product source reads
  it.
- Optional in-product contract compilation is **off by default** — it requires a
  key on the server, an explicit click, and is rate-limited.
- The product renders structurally (never `innerHTML`), sends a strict CSP, and
  rejects zip-slip, absolute paths, oversized uploads and undeclared tools.
- `pnpm scan:secrets` checks tracked files and release packages for keys, private
  keys, environment files and absolute local paths.

Detail: [`docs/security-and-data.md`](docs/security-and-data.md).

## 14. Limitations

Synthetic refund-operations domain; twelve cases; one model family;
template-oriented regex in the semantic lint's task-fact extraction; two
preserved historical provenance defects; USD cost is an estimate, not an invoice.
Both systems saturate the quality metrics, so the suite cannot separate them on
accuracy. This is not a claim of production readiness, and not a claim that
StateProof is more accurate than a frontier model.

Full list: [`docs/limitations.md`](docs/limitations.md).

## 15. Repository map

```text
apps/product/        the interactive application (server + client)
apps/dashboard/      the static evidence dashboard, generated from artifacts
packages/core/       schemas, assertions, state diff, scoring primitives
packages/agents/     Contract Agent, baseline evaluator, run orchestration
packages/benchmark/  fixture loading, validation, gold isolation boundary
packages/sandbox/    the synthetic refund-operations domain
packages/model-provider/  the single provider client and replay mode
packages/submission/ pinned artifact registry, metric combination, pricing
benchmarks/          PhantomBench-12 and PhantomBench-Hard-12 fixtures
prompts/             every versioned prompt, hashed into run manifests
artifacts/           run manifests, predictions, raw responses, contracts, reports
submission/          final evaluation, registry, ledger, reproduction manifest
samples/             a ready-made run package for the import screen
scripts/             reproduction, packaging, scanning, verification
docs/                architecture, evaluation plan, limitations, quick start, video
```

Commands: [`docs/judge-quick-start.md`](docs/judge-quick-start.md).

## 16. Main insight

> **For action-taking agents, the final answer is a claim—not evidence. Compile
> success once, then verify the state left behind.**

Once you stop grading prose and start checking state, the model is needed exactly
once per *task* — not once per *run* — and every execution after that is verified
by code, for nothing.
