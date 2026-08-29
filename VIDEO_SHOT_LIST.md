# Video shot list — StateProof

Serve the dashboard first: `pnpm dashboard:build && pnpm dev` →
`http://localhost:4173/`. Every route below is a real generated page; every
artifact path is a real committed file.

**Never on camera:** `.env`, any API key, any `C:\Users\…` or `/home/…` path,
the raw stdout of the locked StateProof CLI (it prints `no efficiency claim:
quality guardrails not met` because that single invocation had no
`--baseline-run` — the guardrails *were* met; the final report is the authority).

---

| # | Time | Route / source | What is on screen | Notes |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | `/inspector.html` | "The agent's claim" panel, `PBH-B03` | Start scrolled to the claim. Let the viewer read it. |
| 2 | 0:12–0:30 | `/inspector.html` | Requirement cards: `refund_outcome` FAIL, `support_note_outcome` FAIL, `approval_before_refund` FAIL | Scroll slowly. The FAIL pills carry words, not just colour. |
| 3 | 0:30–0:50 | `/index.html` | "The bottleneck" card — the six failure shapes | Overview hero visible above it. |
| 4 | 0:50–1:00 | `/index.html` | "How StateProof works" — the four numbered steps | |
| 5 | 1:00–1:20 | `/benchmark.html` | Combined table, **Frontier baseline** column | Show it scoring 100% across the board. |
| 6 | 1:20–1:35 | `/changelog.html` | Stages 1 and 2 — Core-12 and Hard-12 saturation | Underlines "we did not weaken it". |
| 7 | 1:35–1:50 | `/inspector.html` | Task panel, then the StateProof verdict pill | |
| 8 | 1:50–2:10 | `/inspector.html` | Requirement card reasons, in the monospace detail line | e.g. `RFB-9203.amount = 55.00 USD; expected 40.00 USD` |
| 9 | 2:10–2:22 | `/inspector.html` | **Click an evidence reference** — it scrolls and flashes the target | The single most important interaction in the video. |
| 10 | 2:22–2:30 | `/inspector.html` | Event timeline: amber approval row at `seq 12`, blue `refund.execute` at `seq 8` | Show them in one frame if possible. |
| 11 | 2:30–2:35 | `/inspector.html` | Initial → final state diff, `refunds` section | |
| 12 | 2:35–2:55 | `/architecture.html` | The inline SVG diagram | Trace the cold path left to right. |
| 13 | 2:55–3:10 | `/architecture.html` | "Cold path" and "Warm path" cards | Mention the gold-isolation boundary on the diagram. |
| 14 | 3:10–3:25 | `/changelog.html` | Stage 3 — Contract Agent v1 | Its report/manifest/prompt links are visible. |
| 15 | 3:25–3:40 | `/changelog.html` | Stage 4 — Contract Agent v2 | The selector-ambiguity failure. |
| 16 | 3:40–3:50 | `/changelog.html` | Stage 5 — Contract Agent v3 | |
| 17 | 3:50–4:00 | `/benchmark.html` | "Observed untouched locked result" table | Four cases, run once. |
| 18 | 4:00–4:10 | `/benchmark.html` | "Operating modes across the full suite" table | 12 → 3 → 0 calls; 125,154 → 29,889 → 0 tokens; $0.91 → $0.26 → $0.00. |
| 19 | 4:10–4:25 | Terminal | `pnpm reproduce` → `RESULT: PASSED (26 checks)` | Pre-warm `node_modules`; the run is ~4 s. Terminal must show no key. |
| 20 | 4:25–4:35 | `/benchmark.html` | The scope note: "A 12-case synthetic evaluation — not a generalization claim" | Also in the page subtitle. |
| 21 | 4:35–4:45 | `/index.html` | Hero: "The agent said it was done. Prove it." | Hold for the hot take. |

---

## Optional B-roll, if a shot runs short

| Route / source | What it shows |
| --- | --- |
| `/trajectories.html` → Contract Agent v3 → "Input envelope" | The envelope contains the task, tools and schema — and no trajectory, state or final response. Strong proof of the compile-before-you-look claim. |
| `/trajectories.html` → "Deterministic verification — code, not an agent" | Explicitly labels the verifier as code. |
| `/inspector.html?` → case chips `PBH-A04` / `PBH-C04` | Locked cases, visible only because their one-time evaluation is on the record. |
| `submission/final-evaluation-ledger.jsonl` | Four lines: started/completed for each locked workflow. Nothing else, ever. |
| `submission/final-evaluation.md` | The three-view result the numbers come from. |
| Terminal: `pnpm scan:secrets` | `RESULT: CLEAN`. |

## Exact artifacts behind each claim spoken on camera

| Spoken claim | Artifact |
| --- | --- |
| "fifty-five dollars, not forty" | `artifacts/predictions/RUN-stateproof-hard-development-cold-20260829T022133Z.json` → `PBH-B03` → `refund_outcome` |
| "approval at sequence twelve, execute at eight" | `benchmarks/phantombench-hard-12/cases/PBH-B03/trajectory.jsonl` |
| "twelve calls, 125,154 tokens" | `submission/final-evaluation.md` → Model usage |
| "three calls, 29,889 tokens" | same table, first-deployment column |
| "zero calls, zero tokens" | `artifacts/run-manifests/RUN-stateproof-hard-locked-warm-20260829T040036Z.json` → `modelUsage: null` |
| "$0.91 → $0.26 → $0.00" | `submission/final-pricing-manifest.json` |
| "133 milliseconds" | `submission/final-evaluation.md` → deterministic verification, repeated column |
| "no API key in its environment" | `submission/final-evaluation-ledger.jsonl` + `REPRODUCTION.md` locked-run section |
| "run once, after the freeze" | tag `stateproof-evaluation-freeze-v1` → `c976e3838477afbf951d0faf57011be1b4ef6864` |

## Recording checklist

- [ ] `pnpm dashboard:build && pnpm dev` running before recording starts
- [ ] `pnpm install` already warm so shot 19 is fast
- [ ] Browser at 1440×900 or larger, dark theme (the site is dark by default)
- [ ] Terminal font large enough to read `RESULT: PASSED (26 checks)`
- [ ] Terminal history and prompt contain no path under a home directory
- [ ] No `.env`, no key, no editor sidebar showing local paths
- [ ] Total runtime under 5:00 with ~25 s of buffer
