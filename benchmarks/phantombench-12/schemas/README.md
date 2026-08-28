# PhantomBench-12 schemas

The canonical schemas for every fixture file live in
[`packages/core/src/schema`](../../../packages/core/src/schema) as Zod schemas,
and are the single source of truth. They are executable, so validation cannot
drift from documentation.

| Fixture file          | Schema                                     |
| --------------------- | ------------------------------------------ |
| `task.json`           | `TaskSpecSchema`                           |
| `tool-registry.json`  | `ToolRegistrySchema`                       |
| `initial-state.json`  | `StateSnapshotSchema` (label `initial`)    |
| `final-state.json`    | `StateSnapshotSchema` (label `final`)      |
| `trajectory.jsonl`    | `TrajectorySchema` (one `TraceEvent`/line) |
| `final-response.txt`  | plain UTF-8 text, non-empty                |
| `gold-contract.json`  | `TaskContractSchema`                       |
| `gold-verdict.json`   | `GoldVerdictSchema`                        |
| `case-metadata.json`  | `CaseMetadataSchema`                       |
| `splits/*.json`       | `SplitManifestSchema`                      |

Exporting these as standalone JSON Schema documents is deferred; it is only
worth doing if a non-TypeScript consumer appears.
