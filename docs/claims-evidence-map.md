# Claims-to-evidence map

Every substantive claim StateProof makes, with the artifact that supports it.
Paths are repository-relative.

## How to check any row yourself

```bash
pnpm reproduce          # re-derives the whole result offline
pnpm reproduce:check    # artifacts, hashes and provenance only
```

---

## 1. The frozen baseline cost 8 model calls and 84,616 tokens

| | |
| --- | --- |
| Claim | A general-purpose frontier evaluator needed 8 model calls and 84,616 tokens (74,291 in / 10,325 out) and 115.1 s for the eight hard-development cases. |
| Run manifest | `artifacts/run-manifests/RUN-baseline-hard-development-live-20260828T233139Z.json` — `modelUsage`, `wallClockMs` |
| Report | `artifacts/reports/RUN-baseline-hard-development-live-20260828T233139Z.md` |
| Predictions | `artifacts/predictions/RUN-baseline-hard-development-live-20260828T233139Z.json` |
| Prompt | `prompts/baseline-evaluator/v2.md` (sha256 `d5a03c05b36d9b68…`) |
| Raw responses | `artifacts/model-responses/RUN-baseline-hard-development-live-20260828T233139Z/` |
| Source commit | `41602f8b` — verified by `pnpm check:provenance` |

## 2. StateProof v3 cold matched the baseline on quality

| | |
| --- | --- |
| Claim | SVR 100% (12/12), FVR 0% (0/23), CDR 100% (4/4), BVA 100% (8/8), evidence-reference validity 100% (80/80), zero partial requirements. |
| Report (JSON) | `artifacts/reports/RUN-stateproof-hard-development-cold-20260829T022133Z.json` |
| Report (Markdown) | `artifacts/reports/RUN-stateproof-hard-development-cold-20260829T022133Z.md` |
| Predictions | `artifacts/predictions/RUN-stateproof-hard-development-cold-20260829T022133Z.json` |
| Contracts | `artifacts/contracts/RUN-stateproof-hard-development-cold-20260829T022133Z-contracts/` |
| Prompt | `prompts/contract-agent/v3.md` (sha256 `b3b93c18b63f2794…`) |
| Source commit | `42135267c23841b7c8bb960c01749f58bb53481a`, `sourceTreeClean: true` |

## 3. StateProof v3 cold reduced calls, tokens and wall clock

| | |
| --- | --- |
| Claim | 62.5% fewer model calls (3 vs 8), 64.7% fewer tokens (29,889 vs 84,616), 53.5% less wall clock (53.6 s vs 115.1 s). |
| Computed by | `pnpm compare:development` → `artifacts/reports/development-comparison.md` |
| Guardrail rule | `packages/agents/src/stateproof/score.ts` — `compareEfficiency` returns `null` for every reduction unless SVR = 100%, CDR = 100%, FVR = 0%. |
| Counter-evidence kept | v1 and v2 were cheaper *and* claimed nothing. See their rows in `IMPROVEMENT_CHANGELOG.md`. |

## 4. The warm run made zero model calls and spent zero tokens

| | |
| --- | --- |
| Claim | 0 model calls, 0 tokens, 8/8 cache hits, no raw model-response files. |
| Run manifest | `artifacts/run-manifests/RUN-stateproof-hard-development-warm-20260829T022344Z.json` — `modelUsage: null`, `rawResponsePaths: []`, `sourceContractRunId` set |
| Predictions | `artifacts/predictions/RUN-stateproof-hard-development-warm-20260829T022344Z.json` — every entry `cacheHit: true` |
| Credential absence | Run from a scratch working directory with no `.env`, via `env -u STATEPROOF_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY`. Re-checked every time by `pnpm reproduce`. |

## 5. The warm run took 0.386 seconds

| | |
| --- | --- |
| Claim | 386 ms wall clock for the whole suite, of which 93 ms is deterministic verification. |
| Evidence | `wallClockMs` in the warm manifest; `efficiency.stateproof.verificationWallMs` in `artifacts/reports/RUN-stateproof-hard-development-warm-20260829T022344Z.json` |
| Caveat | Wall clock is machine-dependent. The invariant that matters is the call and token count, which is exactly zero. |

## 6. Repeated verification is deterministic

| | |
| --- | --- |
| Claim | Three warm runs produced byte-identical canonical predictions, identical contract hashes and identical metrics. |
| Runs | `…warm-20260829T022344Z`, `…warm-20260829T022354Z`, `…warm-20260829T022355Z` |
| Pinned hash | `3d8ef516fa5d6d6b…` for all three, in `submission/reproduction-manifest.json` |
| Re-checked by | `pnpm reproduce` (compares a fresh replay against the pinned hash) and `apps/dashboard/test/dashboard.test.ts` |

## 7. No locked case has been run

| | |
| --- | --- |
| Claim | The four hard locked cases (PBH-A04, PBH-B02, PBH-C02, PBH-C04) and the four core locked cases have never been evaluated. |
| Evidence | No prediction, report or manifest in `artifacts/` covers a locked case id. `submission/reproduction-manifest.json` lists them under `lockedCaseIds`, and the registry schema rejects their appearance in `replayCaseIds`. |
| Guards | The CLI refuses `--split locked` without `STATEPROOF_ALLOW_LOCKED_RUN=1`; `pnpm reproduce` asserts no locked case reaches the prediction phase; tests in `packages/agents/test/` and `apps/dashboard/test/` assert it independently. |

## 8. Gold data cannot reach the prediction phase

| | |
| --- | --- |
| Claim | Predictions are written to disk before any gold file is opened, and the prediction code physically cannot import gold. |
| Package boundary | `@stateproof/benchmark` (agent-facing) versus `@stateproof/benchmark/gold` (scoring only) |
| Ordering test | `packages/agents/test/stateproof.test.ts` observes every case-file read and asserts each human-only file was opened only after the prediction artifact existed. |
| Envelope test | The same suite asserts the Contract Agent envelope contains no state, trajectory, final response, case id, split label or gold requirement id. |

## 9. Every evidence reference resolves

| | |
| --- | --- |
| Claim | 80/80 references in the v3 runs resolve to a real event, record or collection. |
| Computed by | `checkEvidenceRefs` in `packages/core/src/score/requirement-metrics.ts`, reported as `evidenceRefValidity` |
| Generated, not written | References are built from the records and events the assertions matched — `packages/core/src/verify/evidence-refs.ts` |
| UI check | `apps/dashboard/test/dashboard.test.ts` asserts every reference on every inspector page scrolls to an element that exists. |

## 10. Headline numbers are not hardcoded

| | |
| --- | --- |
| Claim | Every figure in the dashboard, the judge summary and the comparison table is read from a run artifact. |
| Registry | `submission/reproduction-manifest.json`, generated by `pnpm submission:manifest` |
| Loader | `packages/submission/src/loader.ts` — re-derives every hash and throws `SubmissionArtifactError` rather than rendering unverified data |
| Tests | `apps/dashboard/test/dashboard.test.ts` — tampering with a prediction, a contract or a prompt makes the build fail |

## 11. Two historical provenance defects are preserved, not repaired

| | |
| --- | --- |
| Claim | The Gate 3A run predates its own commit; the Gate 3C cold manifest carries a stale `stage` label. Both are documented and left as recorded. |
| Evidence | `pnpm check:provenance RUN-stateproof-hard-development-live-20260829T004039Z` fails, by design; the v3 cold manifest still reads `gate-3b-stateproof-development-cold` |
| Pinned expectation | `submission/reproduction-manifest.json` marks the v1 run `known-defect`, so an unexpected change in either direction is an error |
| Documented | `docs/limitations.md`; regression test in `packages/agents/test/gate4a.test.ts` |
