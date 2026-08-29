# Video shot list — StateProof

**Live:** <https://stateproof-production.up.railway.app/> · [demo](https://stateproof-production.up.railway.app/demo) · [benchmark](https://stateproof-production.up.railway.app/benchmark) ·
[evidence](https://stateproof-production.up.railway.app/evidence/) · [inspector](https://stateproof-production.up.railway.app/evidence/inspector.html) ·
[trajectories](https://stateproof-production.up.railway.app/evidence/trajectories.html)

> This is the hand-recorded shot list. The **automated** pipeline that produces the
> submitted walkthrough lives in [`../video/`](../video/README.md) — it captures
> these same routes with Playwright and composes with FFmpeg. Its script is
> generated from `video/src/narration.ts`; see
> [`../video/voiceover-script.md`](../video/voiceover-script.md).

Setup, before recording:

```bash
pnpm install
pnpm dashboard:build
pnpm product:build
pnpm product:dev
```

Everything below is reachable from **<http://localhost:4180/>**. The dashboard is
served by the same process at `/dashboard/`, so there is no second server and no
port to switch between on camera.

**Never on camera:** `.env`, any API key, any `C:\Users\…` or `/home/…` path, the
raw stdout of the locked StateProof CLI (it prints `no efficiency claim: quality
guardrails not met` because that single invocation had no `--baseline-run` — the
guardrails *were* met; the final report is the authority).

---

| # | Time | Route | Interaction | Highlight | Narration cue | Fallback |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | `/#/` | None — start scrolled to the proof panel | The claim pane: *"I refunded exactly 40.00 USD … and added the note"* | "That sentence is a claim." | Read the same text from `/#/demo`, "The agent's final claim" card. |
| 2 | 0:12–0:25 | `/#/` | None; let the findings finish revealing | The three findings, especially `RFB-9203.amount = 55.00 USD; expected 40.00 USD` | "Fifty-five, not forty." | Reload the page; the reveal replays. |
| 3 | 0:25–0:40 | `/#/` | Scroll to "The final answer is a claim" | The six failure shapes named in the card | "Teams check by hand. It does not scale." | Same text in `README.md` §2. |
| 4 | 0:40–0:50 | `/#/` | Scroll to "How it works" | The three numbered steps | "Compile once, then verify." | `/dashboard/architecture.html`. |
| 5 | 0:50–1:20 | `/#/benchmark` | Scroll to **Combined (recomputed from counts)** | The **Frontier baseline** column at 100% / 0% / 100% / 100% | "The baseline is good. It gets every case right." | `submission/final-evaluation.md`, combined table. |
| 6 | 1:20–1:32 | `/#/demo` | None | Original task and the agent's final claim, side by side | "Here is the same run in StateProof." | — |
| 7 | 1:32–1:45 | `/#/demo` | **Click "Verify this run"** | The button's progress state, then the inspector loading | "Watch what happens." | If it fails, reload and retry once; if it fails twice, open `/dashboard/inspector.html` and say the verification is prerecorded there. |
| 8 | 1:45–1:55 | `/#/runs/<id>` | None | Solid `FAIL` pill; `Model calls / tokens: 0 / 0`; `Verification time: 1 ms` | "Zero model calls. About a millisecond." | Same three values in the exported JSON pack. |
| 9 | 1:55–2:10 | `/#/runs/<id>` | Scroll the requirement cards | `refund_outcome` FAIL, `support_note_outcome` FAIL, `approval_before_refund` FAIL — pills carry words, not only colour | "Three of five contradicted." | — |
| 10 | 2:10–2:20 | `/#/runs/<id>` | **Click an evidence reference** | The page scrolls and flashes the exact event or record | "Every one of those is a link." | **The one shot not to cut.** If it misbehaves, use the Evidence index section and click from there. |
| 11 | 2:20–2:30 | `/#/runs/<id>` | Scroll to **Timeline** | Amber `human_approval` at `seq 12` and blue `refund.execute` at `seq 8`, ideally in one frame | "Approval at twelve. Refund at eight." | `benchmarks/phantombench-hard-12/cases/PBH-B03/trajectory.jsonl`. |
| 12 | 2:30–2:40 | `/#/runs/<id>` | Scroll to **Contract** | Contract hash, task fingerprint, prompt path + sha256, "frozen contract bundle — no model call" | "Compiled once, cached by fingerprint." | `artifacts/contracts/` bundle index. |
| 13 | 2:40–2:55 | `/dashboard/architecture.html` | Scroll to the inline diagram | The cold path left to right, and the gold-isolation boundary | "Interpretation once; execution by code." | `docs/architecture.md`. |
| 14 | 2:55–3:15 | `/#/benchmark` | Scroll through the three split tables | Development 8, Locked 4, Combined 12 — StateProof column | "Eight developed against, four held out, run once." | `submission/final-evaluation.md`. |
| 15 | 3:15–3:35 | `/#/benchmark` | Scroll to **Model usage across the full suite** | `12 → 3 → 0` calls; `125,154 → 29,889 → 0` tokens; `$0.91 → $0.26 → $0.00` | "Seventy-five percent fewer calls. Then zero." | `submission/final-pricing-manifest.json`. |
| 16 | 3:35–3:50 | `/#/benchmark` | Scroll to **Improvement changelog**, stage 4 | "Contract Agent v1 — replaced": DSL could not express relational scope | "Our first version failed." | `IMPROVEMENT_CHANGELOG.md`. |
| 17 | 3:50–4:05 | `/#/benchmark` | Stage 5 | "Contract Agent v2 — replaced": ambiguous exact-one selector | "So did our second." | Same. |
| 18 | 4:05–4:15 | `/#/benchmark` | Stage 6 | "Contract Agent v3 — final": existential matching plus the lint | "Version three is the one in the box." | Same. |
| 19 | 4:15–4:28 | Terminal | Run `pnpm reproduce` | `RESULT: PASSED (27 checks)` | "None of this needs my API key." | Pre-warm `node_modules`; the run is ~4 s. If it is slow, show `submission/clean-reproduction-report.md`. |
| 20 | 4:28–4:40 | `/#/import` | **Download the sample package, then upload and verify it** | `matched-frozen-contract`, then `PASS` with zero model calls | "Bring your own run." | Show the manifest list and say the sample is at `samples/stateproof-sample-run.zip`. |
| 21 | 4:40–4:52 | `/#/benchmark` | Scroll to **What this does not show** | "Twelve synthetic cases in one domain … does not establish generalization" | "Honest limits." | `docs/limitations.md`. |
| 22 | 4:52–5:00 | `/#/` | Scroll to the bottom | The hot take | Closing line. | `README.md` §16. |

---

## Optional B-roll, if a shot runs short

| Route / source | What it shows |
| --- | --- |
| `/dashboard/trajectories.html` → Contract Agent v3 → "Input envelope" | The envelope carries the task, tools and schema — and no trajectory, state or final response. Direct proof of the compile-before-you-look claim. |
| `/dashboard/trajectories.html` → "Deterministic verification — code, not an agent" | Labels the verifier as code, explicitly. |
| `/dashboard/inspector.html` → case chips `PBH-A04` / `PBH-C04` | Locked cases, visible only because their one-time evaluation is on the record. |
| `submission/final-evaluation-ledger.jsonl` | Four lines: started/completed for each locked workflow. Nothing else, ever. |
| `/#/runs/<id>` → **Export evidence (Markdown)** | The pack a reviewer would send to someone who was not there. |
| Terminal: `pnpm final:verify` | Every check in one command, ending `RESULT: PASSED`. |

## Exact artifacts behind each spoken claim

| Spoken claim | Artifact |
| --- | --- |
| "fifty-five dollars, not forty" | `artifacts/predictions/RUN-stateproof-hard-development-cold-20260829T022133Z.json` → `PBH-B03` → `refund_outcome` |
| "approval at sequence twelve, execute at eight" | `benchmarks/phantombench-hard-12/cases/PBH-B03/trajectory.jsonl` |
| "twelve calls, 125,154 tokens" | `submission/final-evaluation.md` → model usage |
| "three calls, 29,889 tokens" | same table, first-deployment row |
| "zero calls, zero tokens" | `artifacts/run-manifests/RUN-stateproof-hard-locked-warm-20260829T040036Z.json` → `modelUsage: null` |
| "seventy-five percent, seventy-six point one percent" | `submission/final-evaluation.json` → `efficiency` |
| "$0.91 → $0.26 → $0.00" | `submission/final-pricing-manifest.json` |
| "one citation that does not exist" | `submission/final-evaluation.md` → locked split, evidence-reference validity 64/65 |
| "run once, after the freeze" | tag `stateproof-evaluation-freeze-v1` → `c976e3838477afbf951d0faf57011be1b4ef6864` |

## Recording checklist

- [ ] `pnpm dashboard:build && pnpm product:build && pnpm product:dev` running before recording starts
- [ ] `pnpm install` already warm so shot 19 is fast
- [ ] Browser at 1440×900 or larger — the proof panel is side-by-side above 960 px
- [ ] Terminal font large enough to read `RESULT: PASSED (27 checks)`
- [ ] Terminal history and prompt contain no path under a home directory
- [ ] No `.env`, no key, no editor sidebar showing local paths
- [ ] A run already verified once, so shot 7 is not the first cold start
- [ ] Total runtime under 5:00 with ~20 s of buffer
