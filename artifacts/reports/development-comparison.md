# Development comparison

Generated from run artifacts.

| Metric | Frontier baseline | StateProof v1 cold | StateProof v2 cold |
| --- | --- | --- | --- |
| Run id | `RUN-baseline-hard-development-live-20260828T233139Z` | `RUN-stateproof-hard-development-live-20260829T004039Z` | `RUN-stateproof-hard-development-cold-20260829T013429Z` |
| SVR | 100.0% | 83.3% | 91.7% |
| FVR | 0.0% | 4.3% | 0.0% |
| CDR | 100.0% | 50.0% | 75.0% |
| BVA | 100.0% | 100.0% | 75.0% |
| Evidence-ref validity | 100.0% | 100.0% | 100.0% |
| Partial requirements | — | 0 | 1 |
| Model calls | 8 | 5 | 3 |
| Repair calls | 0 | 2 | 0 |
| Input tokens | 74291 | 30912 | 20972 |
| Output tokens | 10325 | 10969 | 8097 |
| Total tokens | 84616 | 41881 | 29069 |
| Wall clock (ms) | 115119 | 103709 | 76568 |
| Deterministic verification (ms) | — | 107 | 84 |
| Contract cache hits | — | 5 | 5 |

- StateProof v1 cold: no reduction claimed — quality guardrails not met (SVR 83.3%, FVR 4.3%, CDR 50.0%, BVA 100.0%).
- StateProof v2 cold: no reduction claimed — quality guardrails not met (SVR 91.7%, FVR 0.0%, CDR 75.0%, BVA 75.0%).
