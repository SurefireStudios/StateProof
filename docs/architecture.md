# Architecture

## The claim this shape exists to support

An action-taking agent's final response is a claim. Verifying it is a *state*
question, and state questions are answerable by code — so the model is used
exactly once per task, to interpret the task, and never again.

```text
agent-visible inputs ──► Contract Agent (model) ──► contract bundle
  task, tools, schema        compile + lint            fingerprint → contract
                                                              │
run under test ──────────► deterministic verifier ◄───────────┘
  trajectory, states,          evaluate assertions
  final response               build evidence refs
                                       │
                                       ▼
                                  predictions ──► scorer (gold, after the fact)
```

## Packages

| Package | Responsibility |
| --- | --- |
| `@stateproof/core` | Schemas, assertion DSL and evaluator, state diff, evidence references, metrics, replay, canonical serialization. |
| `@stateproof/benchmark` | Agent-facing case loading, split resolution, fixture validation. `@stateproof/benchmark/gold` is a separate entry point holding everything gold. |
| `@stateproof/model-provider` | Model client, structured output with one repair retry, credential handling, deterministic fake client for tests. |
| `@stateproof/agents` | Baseline runner and scorer, Contract Agent compiler, contract bundles, deterministic executor, StateProof runner and scorer, source-tree guard. |
| `@stateproof/submission` | The pinned artifact registry and its loader — the only source the dashboard and the replay read from. |
| `apps/dashboard` | Static site generator producing the judge-facing views from artifacts. |

## The two paths

**Cold.** One model call per unique task fingerprint. The Contract Agent sees
the task, the tools and the domain schema. Its output is parsed against the
contract schema, then semantically linted; a failure of either sends the exact
defects back through a single repair retry. An accepted contract is hashed,
written with full provenance, and added to the run's bundle.

**Warm.** The bundle is loaded, every hash re-derived, and each case's
fingerprint recomputed from the task in front of it. A miss **fails closed**
rather than compiling — silently filling a gap would turn a measured warm run
into a partly cold one reported as warm.

The fingerprint covers task text, tool registry, domain schema, assertion schema
version, prompt hash, provider, model id and model configuration. Change any of
them and the contract recompiles; change none and no model is called.

## The assertion DSL

Deterministic, typed, and versioned (currently `2.1.0`). The kinds:

`record_exists`, `record_absent`, `record_exists_matching`,
`record_field_equals`, `record_money_equals`, `record_array_contains_exact`,
`record_field_equals_selected_record_id`, `event_order`, `no_new_records`,
`no_unrelated_mutations`, `mutations_limited_to`.

Three of these carry most of the project's learning:

- **`mutations_limited_to`** — scope over a record the task identifies only by
  relationship ("the support case for this order"). An unresolvable selector is
  `indeterminate`, never `violated`.
- **`record_exists_matching`** — existence, where distractors are expected. At
  least one record must satisfy every literal and relational condition *at once*,
  so two records each satisfying half of a requirement is not a pass.
- **`record_array_contains_exact`** — one array element must satisfy every
  matcher, so two decoy notes cannot satisfy two facts between them.

Money is always a two-decimal string, never a float. Ordering is always by
gap-free `seq`, never by timestamp.

## Verdict rules

- `PASS` — every must-pass requirement verified.
- `FAIL` — at least one disproven.
- `NEEDS_REVIEW` — none disproven, at least one unresolvable.

A requirement declaring `verificationCoverage: "partial"` can FAIL but can never
PASS. Missing evidence never becomes PASS.

## Semantic contract validation

Zod proves shape; the semantic layer proves usability. It rejects ungrounded
ids, duplicate or unknown requirement keys, requirements with no executable
assertion, cross-collection scope selectors, contradictory coverage claims, and
under-specified output-record assertions. It reads only the task text, the
domain schema and the compiled contract — never a run and never gold.

## Gold isolation

Gold contracts and gold verdicts live behind a package boundary. The prediction
phase imports only the agent-facing surface, so it cannot reach them; predictions
are written to disk before the scorer opens its first gold file; and a test
observes every case-file read to assert that ordering directly.

## Provenance

Every run manifest records the source commit, whether the tracked tree was clean,
the prompt file paths and hashes, the assertion schema version, the dataset
hashes, the model configuration, timing and token usage. A live run refuses to
start on a dirty tracked tree, and `pnpm check:provenance` re-derives the prompt
hash from the recorded commit.

## The dashboard

A pure function from artifacts to static HTML. No framework, no runtime, no
network, no credentials: the build reads the pinned registry, validates every
referenced artifact, and either renders or fails. There is nowhere for a
hardcoded number to hide, which is the property that matters for a page whose
entire job is to be believed.
