# Improvement changelog

Every entry records a change to the evaluation system and the evidence that
justified it. Entries are added only after the supporting run artifact exists.

---

### 2026-08-28 — Baseline (development split)

- **Hypothesis:** none. This is the reference point every later stage is
  measured against, not an improvement.
- **What changed:** first live run of the frozen baseline evaluator over the
  eight development cases.
- **Why it changed:** the evaluation protocol requires a fair baseline before
  StateProof is built, and requires knowing whether PhantomBench-12 is
  discriminative before more is invested in it.
- **Run id:** `RUN-baseline-development-live-20260828T222134Z`
- **Manifest:** `artifacts/run-manifests/RUN-baseline-development-live-20260828T222134Z.json`
- **Predictions:** `artifacts/predictions/RUN-baseline-development-live-20260828T222134Z.json`
- **Report:** `artifacts/reports/RUN-baseline-development-live-20260828T222134Z.md`
  and `.json`
- **Raw responses:** `artifacts/model-responses/RUN-baseline-development-live-20260828T222134Z/`
- **Commit:** `a470aa80deccfb97459b8a683a907602426e6e95`
- **Model:** `claude-opus-5`, effort `high`, max tokens 16000, timeout 120s,
  temperature `null` (not accepted by the model)
- **Prompt:** `prompts/baseline-evaluator/v1.md`,
  sha256 `c2bcb3f7adb43e6c8c3c5ba0efb223373ac31500107860c4cd57e203f6646d62`
- **Dataset:** agent-visible `3331475fad91ffc6…`, gold-inclusive `1eede7dfe018c085…`
- **Cases evaluated:** development split, 8 cases (4 gold PASS / 4 gold FAIL):
  PB-A01, PB-A02, PB-A03, PB-B01, PB-B03, PB-B04, PB-C01, PB-C03
- **BVA:** 100.0% (8/8 correct)
- **VAR:** 100.0% (4/4) · **IRR:** 100.0% (4/4)
- **Unsafe false-completion rate:** 0.0% (0/4)
- **NEEDS_REVIEW frequency:** 0.0% (0/8)
- **Runtime / cost:** 91.4s wall clock, 8 calls, 0 repair retries,
  41,345 input / 7,994 output tokens. Cost not priced (`estimatedCostUsd` is
  `null` until an explicit pricing rule exists).
- **Decision:** keep. The prompt is frozen and was not touched after the
  results were seen.
- **Learning:** **the development split is not discriminative against a
  frontier model.** A single general-purpose evaluator, given the same task,
  response, trajectory and both states, scored a perfect 100% BVA with zero
  unsafe false completions and never once declined to decide. It read the
  trace correctly in every invalid case, including the signature
  approval-after-refund ordering violation in PB-A03.

  This leaves no measurable headroom for StateProof on these eight cases.
  Whatever StateProof does next, it cannot demonstrate an accuracy improvement
  here, because there is no error to remove. Reported to the human owner as a
  strategic warning before the locked cases were touched; see
  `docs/progress.md`.

---

## Entry template

Fields follow the evidence rules in `05_EVALUATION_AND_SCORING_SPEC.md`.

```markdown
### YYYY-MM-DD — <stage name>

- **Hypothesis:** what was expected to improve, written before the change when
  practical.
- **What changed:** the smallest targeted change that was made.
- **Why it changed:** the observation that prompted it — a case id, a failure,
  a mutation experiment, a reviewer note.
- **Run id (before):** `RUN-...` → manifest path
- **Run id (after):** `RUN-...` → manifest path
- **Cases evaluated:** which split, which case ids.
- **BVA:** before → after (percentage and raw counts).
- **Unsafe false-completion rate:** before → after.
- **Valid-run acceptance:** before → after.
- **NEEDS_REVIEW frequency:** before → after.
- **Runtime / cost effect:** before → after.
- **Decision:** keep / revise / remove.
- **Learning:** what this actually taught us, including if the answer was "no
  effect".
```

## Rules

1. No entry without a run manifest, a fixture, or a test to point at.
2. Metric values are copied from generated artifacts, never typed from memory.
3. Nothing is tuned against the locked split before the final locked
   comparison. An entry touching locked data must say why.
4. A change that made things worse stays in this file. Removing it would make
   the record dishonest.
5. A "removed experiment" must have actually been implemented and run, with
   artifacts. Do not invent one in advance.
