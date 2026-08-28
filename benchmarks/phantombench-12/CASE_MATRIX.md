# PhantomBench-12 — case matrix status

**The canonical case matrix is
[`04_PHANTOMBENCH_12_CASE_MATRIX.md`](../../04_PHANTOMBENCH_12_CASE_MATRIX.md)
in the repository root.** It defines the task templates, the canonical task
text, the gold requirements, the split, and the isolated failure for every
case. This file is not a second copy of it — it tracks which of those cases
exist as validated fixtures, so the two cannot drift apart.

## Implementation status

| Case | Template | Split | Gold | Isolated failure | Fixture |
| --- | --- | --- | --- | --- | --- |
| PB-A01 | A | development | PASS | — | not authored |
| PB-A02 | A | development | PASS | — | not authored |
| **PB-A03** | **A** | **development** | **FAIL** | **A-PROC-01** | **complete, validated** |
| PB-A04 | A | locked | FAIL | A-OUT-02 | not authored |
| PB-B01 | B | development | PASS | — | not authored |
| PB-B02 | B | locked | PASS | — | not authored |
| PB-B03 | B | development | FAIL | B-OUT-01 | not authored |
| PB-B04 | B | development | FAIL | B-OUT-03 | not authored |
| PB-C01 | C | development | PASS | — | not authored |
| PB-C02 | C | locked | PASS | — | not authored |
| PB-C03 | C | development | FAIL | C-PROH-01 | not authored |
| PB-C04 | C | locked | FAIL | C-SCOPE-01 | not authored |

1 of 12 authored. Target balance once complete: 6 PASS / 6 FAIL, split 8
development / 4 locked (development 4/4, locked 2/2).

Stretch cases `PB-S01` (receipt left as a draft) and `PB-S02` (no-op with a
confident completion claim) are not to be authored until all twelve core cases
validate, the baseline runs, and a comparison report exists.

## Case directory layout

Each case is a directory named for its case id, containing exactly nine files:

| File | Visibility | Schema |
| --- | --- | --- |
| `task.json` | agent-visible | `TaskSpecSchema` |
| `tool-registry.json` | agent-visible | `ToolRegistrySchema` |
| `initial-state.json` | agent-visible | `StateSnapshotSchema` (`initial`) |
| `trajectory.jsonl` | agent-visible | `TrajectorySchema`, one event per line |
| `final-state.json` | agent-visible | `StateSnapshotSchema` (`final`) |
| `final-response.txt` | agent-visible | non-empty UTF-8 text |
| `gold-contract.json` | **human only** | `TaskContractSchema` |
| `gold-verdict.json` | **human only** | `GoldVerdictSchema` |
| `case-metadata.json` | **human only** | `CaseMetadataSchema` |

The agent input reader is an allow-list of the six agent-visible files. The
three human-only files are reachable only through the separate gold reader used
by validation and scoring.

## What the validator checks today

Run with `pnpm benchmark:validate`.

**Structural**

- Every file parses and matches its schema; unknown fields are rejected.
- `schemaVersion` matches across all nine files.
- Case id agrees between the directory name, metadata, gold verdict and gold
  contract; the gold contract targets the task's `taskId`.
- Snapshots are labelled correctly, ordered in time, and share the same
  collections; every record validates against its domain field schema.
- Trajectory: gap-free `seq` from 1, unique event ids, non-decreasing
  timestamps, every called tool is in the registry, every result matches a
  preceding call with the same `callId` and tool, no duplicate or orphan
  results, no unresolved calls.
- State derivability: every changed collection is attributable to a successful
  write call, and successful write calls must have changed something.
- Gold verdict expectations cover exactly the gold contract's requirements.
- Every assertion targets a collection and tool that actually exist.
- Metadata hygiene: a multi-fault case must be explicitly approved; the named
  isolated failure must be a real requirement of the contract.

**Semantic**

- The gold contract is replayed through the deterministic verifier; every
  requirement's computed status must match its gold expectation.
- The computed overall verdict must match the gold verdict, and the gold
  verdict must agree with the case label (`valid` ⇒ `PASS`, `invalid` ⇒ `FAIL`).
- Single-fault discipline: an invalid case not marked `multiFault` must violate
  exactly one must-pass requirement, and it must be the one metadata names.
- Determinism: verification is run twice and the results must be identical, and
  the case is re-loaded and re-hashed to prove loading is stable.

**Cross-case**

- Every case appears in exactly one split manifest, and that split agrees with
  its metadata; no manifest lists a case that has no directory.

Deferred to gate 2: gold balance (6/6) and split size (8/4) checks — with one
case they would fail for the wrong reason.

## Fixture authoring rules

From the canonical matrix, restated because the validator enforces them:

1. Deterministic ids and timestamps; no clock reads, no randomness.
2. Decimal-safe money — two-decimal strings, never floats.
3. Every tool call and result carries a stable event id.
4. Every write event identifies the exact entity mutated.
5. The final state must be derivable from the initial state and successful
   write events.
6. A failed tool call must not mutate state.
7. Invalid core cases violate only their listed isolated requirement.
8. The final response may be misleading; gold scoring relies on state and trace
   evidence only.
9. Agent-visible input excludes gold requirements, expected verdict, isolated
   failure, and split label.
10. The validator confirms semantic intent, not merely JSON shape.
