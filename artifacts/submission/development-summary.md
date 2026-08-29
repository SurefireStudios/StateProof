# StateProof — development summary

> The agent said it was done. Prove it.

For action-taking agents, the final response is a claim—not evidence.

Every number below is read from a pinned run artifact; none is entered by hand.
Generated from `submission/reproduction-manifest.json`.

## Intended user and bottleneck

AI product, evaluation and operations engineers deploying agents that modify business systems.

A plausible final response or tool log can hide a no-op, a partial completion, a wrong target, a wrong amount, an approval that came after the protected action, or an unrelated side effect.

## Architecture

1. Contract Agent compiles the task into typed, machine-checkable requirements — before it sees any run.
1. The compiled contract is fingerprinted and cached, so one task is compiled once.
1. A deterministic verifier evaluates that contract against the trajectory and both state snapshots, with no model in the loop.
1. Every verdict cites evidence generated from the records and events the assertions actually matched.

## Results — hard development split

| Run | SVR | FVR | CDR | BVA | Model calls | Total tokens | Wall clock (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Frontier baseline (Hard-12) | 100.0% | 0.0% | 100.0% | 100.0% | 8 | 84616 | 115119 |
| StateProof v1 cold | 83.3% | 4.3% | 50.0% | 100.0% | 5 | 41881 | 103709 |
| StateProof v2 cold | 91.7% | 0.0% | 75.0% | 75.0% | 3 | 29069 | 76568 |
| StateProof v3 cold | 100.0% | 0.0% | 100.0% | 100.0% | 3 | 29889 | 53562 |
| StateProof v3 warm (measured) | 100.0% | 0.0% | 100.0% | 100.0% | 0 | 0 | 386 |

## Measured reductions versus the frozen baseline

- Cold: 62.5% fewer model calls, 64.7% fewer tokens, 53.5% less wall clock.
- Measured warm: 100.0% fewer model calls, 100.0% fewer tokens, 99.7% less wall clock.
- Break-even: 1 run(s) of the suite.
- Cost in USD is deliberately not claimed: no pricing rule is implemented.

## Deterministic repeat

Warm runs `RUN-stateproof-hard-development-warm-20260829T022344Z`, `RUN-stateproof-hard-development-warm-20260829T022354Z`, `RUN-stateproof-hard-development-warm-20260829T022355Z` produced identical canonical predictions (sha256 `3d8ef516fa5d6d6b`), zero model calls and zero tokens.

## Reproduce

```bash
pnpm install
pnpm reproduce
```

No API credential is required.
