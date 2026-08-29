# Shot list — automated capture

Every clip is captured by `video/src/capture.ts` with Playwright at 1920×1080,
30 fps, against the live deployment (or a local server via `--base`). Each clip
has a stable start and end state and is recorded into its own browser context,
so one failed clip never corrupts the take.

| # | Clip | Route | Action | Holds on | Approx |
| --- | --- | --- | --- | --- | --- |
| 1 | `problem` | `/` | Scroll the worked example, then the failure shapes | The three findings | 26 s |
| 2 | `baseline` | `/benchmark` | Scroll to the combined split table | Frontier baseline column at 100% | 24 s |
| 3 | `demo-setup` | `/demo` | Read the task and the agent's claim | Both cards side by side | 22 s |
| 4 | `demo-verify` | `/demo` → `/runs/:id` | Click **Verify this run** | `FAIL`, 0 calls / 0 tokens | 30 s |
| 5 | `demo-findings` | `/runs/:id` | Scroll the requirement cards | 55.00 vs 40.00, missing note | 22 s |
| 6 | `demo-timeline` | `/runs/:id#timeline` | Scroll to the timeline | approval seq 12 after refund seq 8 | 20 s |
| 7 | `architecture` | `/evidence/architecture.html` | Scroll the diagram | Cold path, gold-isolation boundary | 30 s |
| 8 | `comparison` | `/benchmark` | Scroll to model usage | 12 → 3 → 0 calls | 32 s |
| 9 | `changelog` | `/evidence/changelog.html` | Scroll v1 → v2 → v3 | The v3 entry | 34 s |
| 10 | `reproduce` | `/import?sample` | Sample import, then verify | `PASS`, 0 calls | 24 s |
| 11 | `traces` | `/evidence/trajectories.html` | Scroll the envelope | Contract Agent input envelope | 18 s |
| 12 | `closing` | `/` | Return to the hero | The hot take | 14 s |

Title and section cards are rendered by FFmpeg in `render.ts`, not captured, so
their timing is exact.

## Fallback

`capture.ts --base http://localhost:4180` records against a local production
build instead of the public origin. Use it if the deployment is unavailable or
sleeping. The frames are identical; only the address bar differs, and the
address bar is not in shot — Playwright records the viewport, not the window.
