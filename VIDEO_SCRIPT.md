# Video script — StateProof

**Target: 4:35. Hard ceiling 5:00.** Word counts assume ~150 wpm; the timings
below leave roughly 25 seconds of buffer.

Everything shown is a real artifact or a real dashboard route. Nothing is
mocked. Do not show `.env`, any API key, any local absolute path, or the
standalone locked-CLI stdout line (it prints a misleading "guardrails not met"
because that invocation had no `--baseline-run`; the final report is the
authority).

---

## 0:00–0:30 — Hook

**On screen:** Run Inspector, `PBH-B03`. Start on the agent's final response in
the "agent's claim" panel. Then scroll to the requirement cards.

> An action-taking agent can give you a perfect final answer and still leave the
> wrong state behind.
>
> This agent says it refunded the order, emailed the customer, and got approval
> first. Here's what actually happened. The refund went out for fifty-five
> dollars, not forty. The approval event is at sequence twelve — the refund
> executed at sequence eight. And the support note it claims to have written
> doesn't exist.
>
> Three failures. None of them visible in the answer.

---

## 0:30–1:00 — User and bottleneck

**On screen:** Overview page, top section — the six failure shapes.

> This is for AI product and evaluation teams running agents that change real
> business systems. Refunds. Tickets. CRM records.
>
> Their problem isn't answer quality. It's that a plausible summary and a clean
> tool log can both be there while the work is wrong — a no-op, a partial
> completion, the wrong target, the wrong amount, an approval that arrived after
> the money moved.
>
> And an argument on a tool call saying "approved" is not evidence that anyone
> approved anything. Only the order of events settles that.

---

## 1:00–1:35 — Fair frontier baseline

**On screen:** Benchmark page, the baseline column; then the Changelog rows for
Core-12 and Hard-12 saturation.

> So we built the obvious comparison first: one frontier evaluator — Opus 5 —
> given the same task, the same trajectory, both state snapshots, the same model
> configuration, the same single repair retry.
>
> It was strong. On our first benchmark it got everything right. On the harder,
> requirement-level benchmark it got everything right again — perfect recall,
> perfect diagnosis.
>
> We did not weaken it. When our first benchmark was too easy, we made the
> evaluation more diagnostic instead of handicapping the baseline. Its prompt
> was frozen before StateProof existed and has never been touched since.

---

## 1:35–2:35 — StateProof execution

**On screen:** Run Inspector `PBH-B03` top to bottom — task, claim, verdict,
requirement cards, then click an evidence reference so it scrolls and flashes;
then the event timeline with the approval row highlighted; then the state diff.

> Here's what StateProof does instead.
>
> Before it sees any run, a Contract Agent turns the task into typed,
> machine-checkable requirements. It gets the task, the tools and the domain
> schema — and nothing about what happened. A contract written after the run
> isn't a contract.
>
> Then code — not a model — evaluates that contract against the trajectory and
> both state snapshots.
>
> Refund outcome: failed, fifty-five dollars where forty was required. Support
> note: failed, no note with that text. Approval before refund: failed, the
> approval is at sequence twelve and the execute at sequence eight.
>
> And every one of those cites evidence. Click it, and it takes you to the exact
> event or record it's talking about — because the reference was generated from
> the record that matched, not written by a model. It can't point at something
> that doesn't exist.

---

## 2:35–3:10 — Architecture

**On screen:** Architecture page — the inline diagram, cold path then warm path.

> The architecture is deliberately small.
>
> One Contract Agent call per unique task — not per run. The compiled contract
> is fingerprinted, hashed and persisted, so the second, hundredth and thousandth
> run of the same task cost nothing to verify.
>
> Then a deterministic verifier per run. No model in the loop.
>
> There's no Evidence Agent and no swarm. We measured what extra agents would
> buy on this benchmark, and the answer was nothing — so we didn't ship them.

---

## 3:10–3:50 — Changelog

**On screen:** Changelog page, scrolling stages 3 → 4 → 5.

> Getting there took three iterations, and two of them failed.
>
> Version one compiled reusable contracts and got every overall verdict right —
> but the assertion language couldn't express "only the support case for *this*
> order may change", so it missed a real scope violation.
>
> Version two fixed that, and introduced a new problem: it identified the
> outbound email by recipient alone. Every fixture already has an older email to
> that person, so the check matched two records and couldn't resolve. The
> verifier correctly refused to answer — and that cost us three metrics.
>
> Version three asks the right question: does a record exist that satisfies
> every condition at once? Plus a lint that rejects any contract identifying an
> output record too loosely.
>
> Both failures are still in the repository, with their artifacts.

---

## 3:50–4:25 — Final measured result

**On screen:** Benchmark page — combined table, then the operating-modes table;
then a terminal running `pnpm reproduce` to `RESULT: PASSED`.

> Then we froze the source, tagged it, and ran the four held-out locked cases
> exactly once.
>
> Combined across all twelve: both systems perfect — full recall, zero false
> violations, complete diagnosis.
>
> The difference is everything else. The baseline needed twelve model calls and
> a hundred and twenty-five thousand tokens. StateProof's first deployment
> needed three calls and thirty thousand — seventy-five percent fewer calls,
> seventy-six percent fewer tokens, about ninety-one cents down to twenty-six.
>
> And every repeat after that: zero model calls. Zero tokens. Zero dollars.
> A hundred and thirty milliseconds of deterministic verification for all twelve
> cases.
>
> The locked StateProof run had no API key in its environment at all. And you
> can re-derive the whole thing yourself, offline, with `pnpm reproduce`.

---

## 4:25–4:45 — Limitation and close

**On screen:** Benchmark page scope note, then hold on the Overview hero.

> This is a 12-case synthetic evaluation, not proof of universal generalization.
> What it does prove is that, on these held-out runs, deterministic verification
> preserved measured quality while eliminating repeated model usage.
>
> For action-taking agents, the final answer is a claim — not evidence. Compile
> success once, then verify the state left behind.

---

## Presenter notes

- **Do not show:** `.env`, any key, any `C:\Users\...` path, or the locked CLI's
  standalone stdout. Use the dashboard and `pnpm reproduce` output only.
- Pre-run `pnpm dashboard:build && pnpm dev` before recording; the site must
  already be served.
- Pre-warm `pnpm install` so the `pnpm reproduce` shot is ~4 seconds.
- If you run long, cut the second half of the 3:10 changelog section (keep v1's
  failure and v3's fix, drop v2's detail).
- Numbers to say out loud, all from `submission/final-evaluation.md`: 12 → 3 → 0
  calls; 125,154 → 29,889 → 0 tokens; $0.91 → $0.26 → $0.00; 75.0% / 76.1%;
  133 ms.
