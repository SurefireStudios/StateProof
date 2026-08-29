# Final claims-to-evidence map

Every run behind the final result, with the artifact that proves it.
Regenerate with `pnpm submission:finalize`.

| Run | Id | Canonical prediction sha256 | Manifest | Report | Predictions |
| --- | --- | --- | --- | --- | --- |
| Core-12 diagnostic baseline | `RUN-baseline-development-live-20260828T222134Z` | `fe0414685189019d` | [manifest](../artifacts/run-manifests/RUN-baseline-development-live-20260828T222134Z.json) | [report](../artifacts/reports/RUN-baseline-development-live-20260828T222134Z.md) | [predictions](../artifacts/predictions/RUN-baseline-development-live-20260828T222134Z.json) |
| Frontier baseline (Hard-12) | `RUN-baseline-hard-development-live-20260828T233139Z` | `442419e5c27334be` | [manifest](../artifacts/run-manifests/RUN-baseline-hard-development-live-20260828T233139Z.json) | [report](../artifacts/reports/RUN-baseline-hard-development-live-20260828T233139Z.md) | [predictions](../artifacts/predictions/RUN-baseline-hard-development-live-20260828T233139Z.json) |
| StateProof v1 cold | `RUN-stateproof-hard-development-live-20260829T004039Z` | `e98c0da07dca72cd` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-development-live-20260829T004039Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-development-live-20260829T004039Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-development-live-20260829T004039Z.json) |
| StateProof v2 cold | `RUN-stateproof-hard-development-cold-20260829T013429Z` | `791f62311d44f8e1` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-development-cold-20260829T013429Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-development-cold-20260829T013429Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-development-cold-20260829T013429Z.json) |
| StateProof v3 cold | `RUN-stateproof-hard-development-cold-20260829T022133Z` | `3d8ef516fa5d6d6b` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-development-cold-20260829T022133Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-development-cold-20260829T022133Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-development-cold-20260829T022133Z.json) |
| StateProof v3 warm (measured) | `RUN-stateproof-hard-development-warm-20260829T022344Z` | `3d8ef516fa5d6d6b` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-development-warm-20260829T022344Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-development-warm-20260829T022344Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-development-warm-20260829T022344Z.json) |
| StateProof v3 warm repeat 1 | `RUN-stateproof-hard-development-warm-20260829T022354Z` | `3d8ef516fa5d6d6b` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-development-warm-20260829T022354Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-development-warm-20260829T022354Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-development-warm-20260829T022354Z.json) |
| StateProof v3 warm repeat 2 | `RUN-stateproof-hard-development-warm-20260829T022355Z` | `3d8ef516fa5d6d6b` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-development-warm-20260829T022355Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-development-warm-20260829T022355Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-development-warm-20260829T022355Z.json) |
| Frontier baseline (locked) | `RUN-baseline-hard-locked-live-20260829T035909Z` | `1fa2558582a5f85e` | [manifest](../artifacts/run-manifests/RUN-baseline-hard-locked-live-20260829T035909Z.json) | [report](../artifacts/reports/RUN-baseline-hard-locked-live-20260829T035909Z.md) | [predictions](../artifacts/predictions/RUN-baseline-hard-locked-live-20260829T035909Z.json) |
| StateProof v3 (locked) | `RUN-stateproof-hard-locked-warm-20260829T040036Z` | `57d9c4fc3157e665` | [manifest](../artifacts/run-manifests/RUN-stateproof-hard-locked-warm-20260829T040036Z.json) | [report](../artifacts/reports/RUN-stateproof-hard-locked-warm-20260829T040036Z.md) | [predictions](../artifacts/predictions/RUN-stateproof-hard-locked-warm-20260829T040036Z.json) |

## Frozen contract bundle

| Task fingerprint | Contract hash | Artifact |
| --- | --- | --- |
| `518d723749cdd846` | `45f5df4dca8ba843` | [contract](../artifacts/contracts/RUN-stateproof-hard-development-cold-20260829T022133Z-contracts/518d723749cdd846802792e4bbad4ecb0a5807ac29049dddadddab75a28677c7.json) |
| `92af8e5268a49564` | `661d1b5385b57de3` | [contract](../artifacts/contracts/RUN-stateproof-hard-development-cold-20260829T022133Z-contracts/92af8e5268a49564f9071b70bd3d8b8065d90b5ba1b7ef3b05094fb877320793.json) |
| `9aebb0fc036f4f68` | `3ba65540a8dcad35` | [contract](../artifacts/contracts/RUN-stateproof-hard-development-cold-20260829T022133Z-contracts/9aebb0fc036f4f68b3bc1853ebd8d8fe03aa60299a3167701b385b06e26a0858.json) |

## Prompts

| Prompt | Path | sha256 |
| --- | --- | --- |
| Baseline evaluator v1 | [prompts/baseline-evaluator/v1.md](../prompts/baseline-evaluator/v1.md) | `c2bcb3f7adb43e6c` |
| Baseline evaluator v2 | [prompts/baseline-evaluator/v2.md](../prompts/baseline-evaluator/v2.md) | `d5a03c05b36d9b68` |
| Contract Agent v1 | [prompts/contract-agent/v1.md](../prompts/contract-agent/v1.md) | `fea2ee3fa5d9d588` |
| Contract Agent v2 | [prompts/contract-agent/v2.md](../prompts/contract-agent/v2.md) | `880e3e23b6c3557b` |
| Contract Agent v3 | [prompts/contract-agent/v3.md](../prompts/contract-agent/v3.md) | `b3b93c18b63f2794` |

## Final ledger

The one-time locked protocol records every attempt, including failures, in
[`final-evaluation-ledger.jsonl`](final-evaluation-ledger.jsonl).

## Guardrail rule

An efficiency claim requires SVR 100%, CDR 100%, FVR 0% and evidence-reference
validity 100% on **both** the locked and the combined result. The generator emits
`efficiency: null` otherwise — see `packages/submission/src/combine.ts`.
