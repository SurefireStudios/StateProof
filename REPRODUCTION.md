# Reproduction

Everything in this document runs **without an API credential**. Neither
`STATEPROOF_ANTHROPIC_API_KEY` nor `ANTHROPIC_API_KEY` is read, required, or
accepted by any command below.

## Requirements

- Node.js `>=20.10.0`
- pnpm `>=8.12.0`

## The one command

```bash
pnpm install
pnpm reproduce
```

`pnpm reproduce` performs sixteen checks and prints `RESULT: PASSED` only if all
of them hold:

1. Core-12 fixtures validate (schema + semantic + gold consistency).
2. Hard-12 fixtures validate.
3. The pinned registry `submission/reproduction-manifest.json` parses and every
   referenced file exists.
4. Every pinned prompt hash, contract hash and canonical prediction hash is
   re-derived and compared.
5. No locked case is registered or replayed.
6. The committed v3 contract bundle loads with full integrity verification.
7. The eight hard-development cases are re-verified from that bundle.
8. Zero model calls; `modelUsage` is null.
9. Zero model tokens.
10. No raw model-response file is written.
11. All eight cases report `cacheHit: true`.
12. Canonical predictions are byte-identical to the pinned warm run.
13. Contract hashes match the pinned run, case by case.
14. SVR, FVR, CDR and BVA match the pinned report exactly.
15. Every evidence reference resolves (80/80).
16. No locked case reaches the prediction phase, and only development cases are
    scored.

Expected tail:

```text
  model calls        0 (baseline needed 8)
  model tokens       0 (baseline needed 84616)
  SVR / FVR / CDR    100.0% / 0.0% / 100.0%
  BVA                100.0%

RESULT: PASSED (16 checks)
```

It fails on a tampered contract, a missing artifact, a hash mismatch, a changed
prediction, an unresolved evidence reference or any locked-case access.

## Faster variant

```bash
pnpm reproduce:check
```

Validates the benchmarks, the registry, every artifact hash and run provenance,
without re-running verification.

## Everything else that runs offline

```bash
pnpm typecheck
pnpm test
pnpm benchmark:validate
pnpm benchmark:validate-hard
pnpm dashboard:build
pnpm dev                      # http://localhost:4173/
pnpm compare:development "Frontier baseline=RUN-baseline-hard-development-live-20260828T233139Z" \
                         "StateProof v3 cold=RUN-stateproof-hard-development-cold-20260829T022133Z" \
                         "StateProof v3 warm=RUN-stateproof-hard-development-warm-20260829T022344Z"
pnpm check:provenance RUN-stateproof-hard-development-cold-20260829T022133Z
```

`pnpm check:provenance` re-derives a run's prompt hash from the commit its
manifest records. It passes on the v2 and v3 runs and **fails on the Gate 3A
run**, which is the documented provenance defect described in
[`docs/limitations.md`](docs/limitations.md).

## Commands that do require a credential

These are how the recorded results were produced. Nothing in this repository
needs them re-run.

```bash
pnpm benchmark:smoke-model
pnpm benchmark:baseline
pnpm benchmark:baseline-hard
pnpm benchmark:stateproof-hard -- --split development \
  --prompt prompts/contract-agent/v3.md \
  --baseline-run RUN-baseline-hard-development-live-20260828T233139Z
```

They read `STATEPROOF_ANTHROPIC_API_KEY` from `.env` — deliberately **not**
`ANTHROPIC_API_KEY`, which belongs to your own tooling and is never read. A live
cold run also refuses to start unless the tracked working tree matches HEAD, so
every result stays re-derivable from a commit.

Expected variability: a live run calls a frontier model, so token counts and
wall-clock time vary between runs, and a differently-worded contract is possible.
The warm path has no such variability — it is deterministic by construction, and
the repeat check in `pnpm reproduce` is what demonstrates that.

## What the recorded runs cost

| Run | Model calls | Tokens | Wall clock |
| --- | --- | --- | --- |
| Frontier baseline (Hard-12 development) | 8 | 84,616 | 115.1 s |
| StateProof v3 cold | 3 | 29,889 | 53.6 s |
| StateProof v3 warm | 0 | 0 | 0.386 s |

USD cost is not stated: no pricing rule is implemented, and inventing one would
be a fabricated number in a project about not fabricating numbers.
