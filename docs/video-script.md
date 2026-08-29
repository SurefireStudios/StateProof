# Video script — StateProof

Target: **5:00 maximum.** Every figure spoken aloud is in
[`video-shot-list.md`](video-shot-list.md) with the artifact it comes from.
Nothing is dramatised: the demo verification is executed live on camera, and the
verdict it produces is the verdict in the submitted predictions.

Before recording, run `pnpm product:build && pnpm product:dev` and
`pnpm dashboard:build`. Both surfaces are then reachable from one server at
<http://localhost:4180/>.

---

## 0:00–0:25 — The problem

> An agent just told you it issued a forty-dollar refund, emailed the receipt,
> added the support note, and got approval first.
>
> Here is the thing. That sentence is a claim. It is not evidence.
>
> The refund went out for fifty-five dollars. The note was never written. And the
> approval was recorded four steps *after* the money moved.
>
> Every tool call in that run returned "ok."

*On screen: the product home page. The claim panel on the left, then the three
findings appearing on the right.*

## 0:25–0:50 — Who has this, and why checking is expensive

> If you ship agents that only read things, a wrong answer is embarrassing. If
> you ship agents that *change* things — refunds, tickets, CRM records,
> inventory — a wrong answer is a business incident.
>
> So teams check. They read the summary, skim the tool log, and open the
> database. That is slow, it does not scale, and the failure that hurts most —
> an approval that arrived too late — is invisible in both the summary and the
> log.

*On screen: scroll to "The final answer is a claim" and "How it works".*

## 0:50–1:20 — The fair baseline

> The obvious fix is to ask a frontier model to grade it. So that is the
> baseline, and it is a genuinely fair one: the same task, the same final
> response, the same trajectory, the same before-and-after state, the same
> model, the same configuration, the same retry budget.
>
> Its prompt was frozen before StateProof existed and has never been tuned.
>
> And it is good. On this benchmark it gets every case right.

*On screen: `/#/benchmark`, combined table, the **Frontier baseline** column at
100% across the board.*

## 1:20–2:20 — The demo

> Here is the same run in StateProof. This is the task. This is what the agent
> said. Watch what happens when I press verify.

*Press **Verify this run**. Let the progress state show.*

> Fail. Five requirements checked, three contradicted — and look at the bottom
> of the panel: zero model calls, zero tokens, about a millisecond.
>
> Wrong amount: the record says fifty-five, the contract required exactly forty.
> The support note: absent. And the approval — sequence twelve, after the refund
> executed at sequence eight.
>
> Every one of those is a link.

*Click an evidence reference; it scrolls and flashes the exact event.*

> That is the whole idea. Not a second opinion about the summary. A citation
> into the state the agent left behind.

## 2:20–2:55 — Compile once, verify forever

> Interpreting a natural-language task is genuinely model-shaped work. So we do
> it once. A Contract Agent turns the task into typed, machine-checkable
> requirements — before it has seen the trajectory, the state, or the agent's
> answer.
>
> That contract is cached by a fingerprint over the task, the tools, the domain
> schema, the assertion vocabulary, the prompt and the model configuration.
>
> After that, every run of that task is checked by code. Same inputs, same
> verdict, every time, for nothing.

*On screen: the inspector's **Contract** section — hash, fingerprint, prompt
path, prompt hash, "frozen contract bundle — no model call". Then `/dashboard/`
→ architecture diagram.*

## 2:55–3:35 — What it measured

> Twelve synthetic cases. Eight we developed against, four held out and run
> exactly once after we froze the source.
>
> On quality, it is a tie: both systems, one hundred percent recall, zero false
> violations, complete diagnosis on every case.
>
> What is not a tie is everything else. Twelve model calls become three on first
> deployment — seventy-five percent fewer — and seventy-six point one percent
> fewer tokens. Every run after that is zero calls and zero tokens.
>
> One difference in quality, and it is small: on the held-out split the baseline
> cited one piece of evidence that does not exist. StateProof cannot do that —
> its citations are generated from what the assertions matched.

*On screen: `/#/benchmark` — the three split tables, then model usage.*

## 3:35–4:15 — What went wrong on the way

> Two of our own versions failed, and both are in the submission.
>
> Version one produced reusable contracts but its assertion language could not
> say "only the support case *for this order* may change," so it flagged scope
> violations that were not there.
>
> Version two fixed that and introduced a new one: it identified outbound
> messages by recipient alone, and a pre-existing email to the same person made
> the check unresolvable. The verifier did the right thing — it refused to
> return a verdict rather than guess.
>
> Version three added existential matching and a lint that rejects
> under-specified selectors before they ever run. That is the one in the box.

*On screen: `/#/benchmark` → improvement changelog, stages four through six.*

## 4:15–4:40 — Reproduce it, or bring your own run

> None of this needs my API key. Neither does yours.

*Terminal: `pnpm reproduce` → `RESULT: PASSED (26 checks)`.*

> Twelve cases re-verified from committed artifacts, metrics recomputed from
> counts, every evidence reference checked. Four seconds.
>
> And if you want to try it on something that is not ours — import a run
> package. Here is a sample.

*Import screen: download the sample, upload it, verify → `PASS`, zero calls.*

## 4:40–5:00 — Limits, and the point

> Honest limits: twelve synthetic cases, one domain, one model family. This does
> not prove StateProof generalises, and it does not claim to be smarter than a
> frontier model. It matched it.
>
> What it shows is this.

*On screen: the home page hot take.*

> For action-taking agents, the final answer is a claim — not evidence. Compile
> success once, then verify the state left behind.

---

## Delivery notes

- Speak the numbers slowly: **fifty-five, not forty**; **sequence twelve, not
  eight**; **seventy-five percent**; **zero and zero**.
- Never say "more accurate than the baseline." It matched the baseline.
- The one interaction that must land is clicking an evidence reference. If
  anything is cut for time, cut narration, not that click.
- Nothing is faked. If the live verification misbehaves, take the fallback in
  the shot list and say so.
