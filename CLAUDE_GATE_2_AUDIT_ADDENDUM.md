# StateProof Gate 2 — Source-Audit Addendum

Apply this addendum during Gate 2 without expanding scope beyond Gate 2.

## 1. Normalize line endings before creating run manifests

The current Windows working tree shows many files as modified even though the differences are CRLF-only. Add a root `.gitattributes`:

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
```

Normalize once, verify `git diff --ignore-space-at-eol` is empty apart from intentional Gate 2 work, and commit the normalization separately or with a clearly labeled commit. This prevents false dirty-tree states and unstable commit/reproduction records.

## 2. Add a relational assertion for receipt-to-refund linkage

The canonical A/B requirement says the sent receipt must reference the completed refund. The Contract Agent will compile the contract before seeing the run, so it cannot know a generated refund id such as `REF-8801`. Do not solve this by hardcoding fixture-generated IDs into agent-produced contracts.

Add one generic deterministic assertion capable of proving a relationship between selected records, for example:

```text
record_field_equals_selected_record_id
- leftState
- leftSelector
- leftField
- rightState
- rightSelector
```

It should verify that the selected email's `refundId` equals the id of the selected completed refund. It must return `indeterminate` when either selector is ambiguous and `violated` when a required record or field is absent. Unit-test matching, mismatch, missing record, and ambiguous selectors.

Gold contracts may still contain concrete IDs for human reference, but the final StateProof workflow must be able to express and verify the relationship without knowing generated IDs in advance.

## 3. Add the exact-note assertion needed by templates B and C

Support notes will be array-like data. Add a deterministic assertion such as `record_array_contains_exact` rather than comparing an entire notes array or asking a model to judge substring similarity.

Required behavior:

- exact string match;
- no case folding or fuzzy match;
- missing record/field is a violation when the collection exists;
- malformed/non-array field is a violation;
- ambiguous record selector is `indeterminate`.

## 4. Validate EventSelector field combinations

`EventSelectorSchema` currently accepts nonsensical but schema-valid combinations, such as `status` on a `tool_call` or `scope` on an `agent_message`. Add `superRefine` rules:

- `toolName`: only `tool_call` or `tool_result`;
- `status`: only `tool_result`;
- `argumentMatches`: only `tool_call`;
- `scope` and `decision`: only `human_approval`.

This matters before model-generated contracts are introduced; invalid combinations should fail schema validation rather than silently match nothing.

## 5. Keep baseline prediction physically separated from gold loading

Do not use `loadBenchmarkCase()` inside the baseline runner because it loads gold data before agent-visible data. Implement explicit phases/APIs:

1. load agent-visible split cases;
2. call model and persist raw response + parsed prediction;
3. close prediction phase;
4. load gold only in scoring code.

Prefer separate modules/entry points for agent input and scoring. Add a test with instrumented readers proving that no gold file is read until after the prediction artifact is written.

Also fix the current path-parameter bug: `loadAllCases(casesDir)` lists IDs from `casesDir` but then loads them through the global default directory. Thread the supplied case root through `loadBenchmarkCase`, `loadAgentVisibleCase`, and `loadGoldBundle` where appropriate so temporary-fixture tests actually test the temporary fixtures.

## 6. Make replay validation prove referential integrity

In addition to canonical final-state equality, validate at least:

- every refund references an existing order;
- every non-null email `relatedOrderId` references an existing order;
- every non-null email `refundId` references an existing refund;
- receipt refund/order references agree with each other;
- `status: sent` requires a non-null `sentAt`;
- a successful refund effect updates the intended order and creates the declared refund only;
- failed calls and read-only calls have zero state effect;
- support notes attach to the intended support case/order;
- successful write result IDs agree with replay-created entity IDs.

## 7. Strengthen human-only schema hygiene

Before all 12 fixtures are accepted, enforce:

- every core case has `approvedForUse: true`;
- valid cases have `failureMode`, `failureDescription`, and `isolatedFailureRequirementId` all `null`;
- gold requirement expectation IDs are unique and exactly equal the gold-contract requirement IDs;
- all approved case IDs, splits, labels, and isolated failures exactly match the canonical matrix.

## 8. Baseline integrity and competition risk

Keep the baseline fair, but do not give it case IDs, split labels, canonical requirement IDs, or the case matrix. Serialize only the task instruction, final response, trajectory, states, and read-only evidence descriptions.

Freeze the prompt before StateProof tuning. Use realistic decoy records and trace noise exactly where the matrix calls for them. Do not simplify all fixtures into tiny one-record examples; a frontier model may otherwise score perfectly and leave no measurable improvement for the structured workflow.

## Stop condition remains unchanged

Do not start the Contract Agent, Evidence Agent, StateProof final workflow, dashboard, or locked evaluation during Gate 2.
