# Improvement changelog

Every entry records a change to the evaluation system and the evidence that
justified it. Entries are added only after the supporting run artifact exists.

**No entries yet.** The measurement pipeline does not exist, so there is
nothing measured to report. This file must not be filled with expectations.

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
