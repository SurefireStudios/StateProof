# Final submission checklist

Every box below is verified by a command in this repository, not by inspection.
Run the command to re-check it.

## Evaluation integrity

| | Item | How to verify |
| --- | --- | --- |
| ☑ | Baseline and StateProof used the same cases, model, configuration and repair budget | `pnpm submission:finalize` refuses mismatched prompt/model/dataset/split/case-id/contract provenance |
| ☑ | Baseline prompt frozen before StateProof was tuned | `prompts/baseline-evaluator/v2.md`, unchanged since commit `41602f8b` |
| ☑ | Gold data never reaches the prediction phase | ordering test in `packages/agents/test/stateproof.test.ts` |
| ☑ | Contract Agent never sees a run | envelope test in the same suite; `/trajectories.html` shows the envelope |
| ☑ | Locked split run exactly once, after the freeze | `submission/final-evaluation-ledger.jsonl` — one `started` + one `completed` per workflow |
| ☑ | Locked split cannot be run again | `pnpm test` → `gate4b.test.ts` "refuses a workflow that has already completed" |
| ☑ | Core-12 locked split never run | no locked run on `phantombench-12` in `artifacts/run-manifests/` |
| ☑ | Every fixture passes schema and semantic validation | `pnpm benchmark:validate`, `pnpm benchmark:validate-hard` |
| ☑ | Missing evidence never becomes PASS | `NEEDS_REVIEW` verdict rule; partial coverage can FAIL but never PASS |
| ☑ | Headline metrics generated from raw artifacts | `pnpm submission:finalize`; the dashboard throws rather than rendering unverified data |
| ☑ | Failed iterations preserved | v1 and v2 runs, reports and prompts all still present |

## Reproducibility

| | Item | How to verify |
| --- | --- | --- |
| ☑ | Reproduction needs no API key | `pnpm reproduce` → `RESULT: PASSED (26 checks)` |
| ☑ | Replay makes zero model calls and zero tokens | checks 5–7 of that run |
| ☑ | All twelve canonical prediction hashes match | checks 10 and 18 |
| ☑ | Replay does not overwrite submitted artifacts | check "submitted artifacts are untouched" |
| ☑ | Clean checkout works with no `.env` or `node_modules` | `pnpm test:clean-reproduction` → `submission/clean-reproduction-report.md` |
| ☑ | No absolute development path in the built site | same report, "Absolute development paths" section |
| ☑ | Release package rebuilds and reproduces after extraction | `pnpm package:submission` → `submission/final-package-manifest.json` |
| ☑ | Every run traceable to a commit | `pnpm check:provenance <runId>` |

## Security and data

| | Item | How to verify |
| --- | --- | --- |
| ☑ | No credential in any tracked file or package | `pnpm scan:secrets` → `RESULT: CLEAN` |
| ☑ | `.env` and stray copies excluded from git and the package | `.gitignore`; `git archive` is the package include-list |
| ☑ | `.env.example` tracked and blank | scan rule `env-example-value` |
| ☑ | All data synthetic | `docs/security-and-data.md` |
| ☑ | Evidence tools read-only; all writes sandboxed | same document |
| ☑ | Licensed | `LICENSE` (MIT), `"license": "MIT"` in `package.json` |

## Claims

| | Item | Where |
| --- | --- | --- |
| ☑ | Strongest claim stated exactly, with the 12-case limitation attached | `SUBMISSION.md` §8–9, §12 |
| ☑ | 12-case limitation visible in README, dashboard, summary, video script and limitations | five places, none of them fine print |
| ☑ | No claim of universal accuracy, cross-domain generality, production safety, or zero cost | `docs/limitations.md` |
| ☑ | Timing split into model-call wall time / deterministic verification / end-to-end elapsed | `submission/final-evaluation.md`, `/benchmark.html` |
| ☑ | `0.587 s` never described as model wall clock | it is end-to-end elapsed; model-call wall time is `0` |
| ☑ | Baseline not described as evidence-perfect | 205/206 combined, with the unresolved reference named |
| ☑ | API cost is a dated pricing-snapshot estimate, not an invoice | `submission/final-pricing-manifest.json` |
| ☑ | Locked-CLI stdout disclosure recorded | `submission/final-evaluation.md`, `/benchmark.html`, `docs/limitations.md` |
| ☑ | Historical `gate-3b…` stage label preserved and documented | `docs/limitations.md`; regression test in `gate4a.test.ts` |

## Deliverables

| | Item |
| --- | --- |
| ☑ | `README.md`, `SUBMISSION.md`, `JUDGE_QUICKSTART.md`, `REPRODUCTION.md` |
| ☑ | `IMPROVEMENT_CHANGELOG.md`, `PREEXISTING_WORK.md` |
| ☑ | `docs/` — project brief, evaluation plan, architecture, limitations, claims map, agent prompts, security, decision records |
| ☑ | `submission/` — final evaluation, claims map, run registry, pricing manifest, package manifest, ledger, clean-reproduction report |
| ☑ | `VIDEO_SCRIPT.md`, `VIDEO_SHOT_LIST.md` |
| ☑ | Static dashboard, six views, built from artifacts |
| ☑ | Representative trajectory for every agent role, verifier labelled as code |
| ☑ | `release/stateproof-submission-final.zip` with sha256 and manifest |

## Remaining manual steps

These are the only things a person still has to do:

1. **Record the video** using `VIDEO_SCRIPT.md` and `VIDEO_SHOT_LIST.md`.
2. **Delete `.env - Copy.example`** from the working directory if it is still
   there. It is git-ignored and was never packaged, but it should not exist
   locally.
3. **Optionally enable GitHub Pages** for the dashboard — see
   `docs/hosting.md`. Not required for reproduction.
4. **Submit** the repository, the package and the video.
