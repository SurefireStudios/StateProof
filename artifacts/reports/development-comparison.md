# Development comparison

Generated from run artifacts.

| Metric | Frontier baseline | StateProof v1 cold | StateProof v2 cold | StateProof v3 cold | StateProof v3 warm measured |
| --- | --- | --- | --- | --- | --- |
| Run id | `RUN-baseline-hard-development-live-20260828T233139Z` | `RUN-stateproof-hard-development-live-20260829T004039Z` | `RUN-stateproof-hard-development-cold-20260829T013429Z` | `RUN-stateproof-hard-development-cold-20260829T022133Z` | `RUN-stateproof-hard-development-warm-20260829T022344Z` |
| SVR | 100.0% | 83.3% | 91.7% | 100.0% | 100.0% |
| FVR | 0.0% | 4.3% | 0.0% | 0.0% | 0.0% |
| CDR | 100.0% | 50.0% | 75.0% | 100.0% | 100.0% |
| BVA | 100.0% | 100.0% | 75.0% | 100.0% | 100.0% |
| Evidence-ref validity | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Partial requirements | — | 0 | 1 | 0 | 0 |
| Model calls | 8 | 5 | 3 | 3 | 0 |
| Repair calls | 0 | 2 | 0 | 0 | 0 |
| Input tokens | 74291 | 30912 | 20972 | 24245 | 0 |
| Output tokens | 10325 | 10969 | 8097 | 5644 | 0 |
| Total tokens | 84616 | 41881 | 29069 | 29889 | 0 |
| Wall clock (ms) | 115119 | 103709 | 76568 | 53562 | 386 |
| Deterministic verification (ms) | — | 107 | 84 | 103 | 93 |
| Contract cache hits | — | 5 | 5 | 5 | 8 |

- StateProof v1 cold: no reduction claimed — quality guardrails not met (SVR 83.3%, FVR 4.3%, CDR 50.0%, BVA 100.0%).
- StateProof v2 cold: no reduction claimed — quality guardrails not met (SVR 91.7%, FVR 0.0%, CDR 75.0%, BVA 75.0%).
- StateProof v3 cold vs baseline: model calls 62.5%, tokens 64.7%, wall clock 53.5%.
- StateProof v3 warm measured vs baseline: model calls 100.0%, tokens 100.0%, wall clock 99.7%.
- Break-even: 1 run(s) of the suite before compiling once is cheaper.
