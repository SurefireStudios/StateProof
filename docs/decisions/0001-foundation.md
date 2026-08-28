# 0001 — Foundation decisions

Status: accepted. Date: gate 1.

Decisions taken while building the foundation, and the reasoning that is not
obvious from the code.

## Workspace shape: two packages, not five

The suggested layout lists `core`, `agents`, `sandbox`, `benchmark`,
`model-provider` and a web app. Gate 1 creates only `packages/core` and
`packages/benchmark`, with the workspace globs (`packages/*`, `apps/*`) already
allowing the rest.

Empty packages are not free: each one adds a manifest, a dependency edge and a
place for drift, while proving nothing. The conceptual boundary that actually
matters right now is **model interpretation vs deterministic scoring**, and
that boundary is enforced by `core` containing no model client and no I/O
beyond hashing. `agents` and `model-provider` arrive when there is code to put
in them.

The sandbox is currently data (`StateSnapshot` fixtures) plus a domain schema
module, not an engine. A `sandbox` package is warranted when there is a state
machine that applies write events; today that would be a package containing a
type alias.

## Money is a two-decimal string, not a float or cents

Exact monetary equality is a required assertion type. `125.00` is not exactly
representable in binary floating point, so `===` on numbers is unsafe by
construction. Integer minor units would also work, but decimal strings keep
fixtures readable (`"amount": "125.00"`) which matters when the acceptance
criterion is "the sample case is understandable by reading its files".

The schema enforces exactly two fraction digits, so `"125.0"` and `"125.000"`
are rejected rather than silently compared. `normalizeAmount` collapses leading
zeros and `-0.00` so equality is total.

**Limitation:** zero-decimal (JPY) and three-decimal (BHD) currencies are not
representable. The synthetic domain is USD-only. Widening this means changing
`DecimalAmountSchema` and the normalizer together.

## Generic state model, domain schema on top

`StateSnapshot` is `collections: Record<string, StateRecord[]>` where a record
is `{ id, fields }`. State diffing, "no unrelated mutation" and "no new record"
checks are then domain-independent and get unit-tested once.

Domain shape is not lost: `domain/refund-ops.ts` validates every record's
fields against a per-collection Zod schema, and the validator runs it over both
snapshots. This keeps the deterministic engine reusable while still catching a
typo in a fixture field name.

## Ordering uses `seq`, not timestamps

Trace events carry a 1-based, gap-free, strictly increasing `seq`, and every
ordering assertion compares `seq`. Timestamps are validated as
non-decreasing and are present for human readability, but two events can share
a timestamp at millisecond resolution and a verifier must not be at the mercy
of that. `seq` gives a total order with no tie-breaker rules to get wrong.

## A requirement is a conjunction of assertions

`ContractRequirement.assertions` is an array. The canonical case matrix states
gold requirements at a granularity that bundles several checkable conditions
("a sent receipt exists with recipient exactly `dana@example.com` and reference
to the completed refund" is three conditions). Splitting those into separate
requirements would silently change the approved requirement set; folding them
into one over-broad selector would produce a useless failure message.

A conjunction keeps the approved requirement ids intact and still produces
per-assertion evidence. An empty array means "not machine-checkable" and can
never be auto-verified.

## `indeterminate` is only for missing evidence

Assertion outcomes are `satisfied` / `violated` / `indeterminate`, and only
`indeterminate` maps to `insufficient_evidence`. It is reserved for cases where
the evidence itself is absent or ambiguous — a collection that does not exist,
a selector matching more than one record. Data that is present and wrong is
`violated`. Softening a wrong value into "needs review" would let a bad run
escape a `FAIL`.

One deliberate subtlety: `event_order` is **vacuously satisfied** when the
protected action never occurred. Nothing can precede an action that did not
happen, and a no-op agent should fail on its outcome requirements, not
accumulate spurious process violations.

## Verifier output contains no timestamps

`EvidenceRecord` has no `collectedAt`, and evidence ids are derived from the
requirement id and position. Verification is therefore a pure function of the
fixture, so its output can be hashed, diffed and replayed. The validator
exploits this: it runs verification twice and fails the case if the two results
differ.

## Gold isolation is an allow-list, not a deny-list

`createAgentInputReader` accepts exactly six filenames. A deny-list of
`gold-*.json` would silently expose any future human-only file that happens to
be named differently. The allow-list fails closed: a new file is invisible to
agent-facing code until someone explicitly adds it.

`AgentVisibleCase` is additionally a strict schema, so gold data cannot be
attached to an agent input object even in memory.

## Licensing

No open-source license is granted yet. The competition's submission and
licensing requirements govern the choice, and picking one before those are
settled could conflict with them. `LICENSE` records this explicitly as a
deferred decision with a narrow grant to organisers and judges, and names the
action required before submission. Adding a permissive license later is easy;
retracting one is not.

## Dependencies

Five packages, all pinned exactly: `zod`, `typescript`, `vitest`, `tsx`,
`@types/node`. No orchestration framework — the brief says not to add one
unless it clearly simplifies the implementation, and at this size it would only
add indirection. `tsx` exists so `benchmark:validate` runs from source without
a build step; if a build is introduced later, `tsx` can go.

Cross-package imports resolve through package `exports` pointing at TypeScript
source, with matching `paths` in `tsconfig.base.json` and aliases in
`vitest.config.ts`. Belt and braces, but it means the same import specifier
works in `tsc`, `vitest` and `tsx` on Windows without a build artifact.

## Deferred deliberately

- Metric computation (BVA and friends): belongs with the runs it scores.
- JSON Schema export of the fixture schemas: Zod is the single source of truth;
  export only if a non-TypeScript consumer appears.
- Reconstructing the final state by replaying write events. The validator
  currently checks the weaker, cheap property: every changed collection must be
  attributable to a successful write call, and successful writes must change
  something. Full reconstruction needs a sandbox engine.
- Checking that a failed tool call left no state change. Needs the same engine.
- Gold balance checks (6 PASS / 6 FAIL, 8/4 split sizes) — meaningless with one
  case, and would fail the gate for the wrong reason. Belongs in gate 2.
- `git init`. The repository is not a git repository and the brief did not ask
  for one; `.gitignore` is in place for when it becomes one. `commitSha` in the
  run manifest is nullable for exactly this reason.
