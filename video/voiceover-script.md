# Voiceover script

Timings are **planned**; re-run after `pnpm video:render` to measure them.
Total picture: **5:26**. Script: **560 words**, about 3:60 at 140 words per minute.

Read it unhurried. The picture has room, and the three number pairs are the
whole point — slow down on those.

---

## 0:00 – 0:12 · Title card

*9 words in 12 s — 8 s of headroom*

> StateProof. The agent said it was done. Prove it.

## 0:12 – 0:38 · The claim, and the three things the state says instead

*91 words in 26 s — **13 s over, trim this one***

> An agent just reported success. It refunded forty dollars, emailed the receipt, added a support note, and got approval first.
> That sentence is a claim. It is not evidence.
> The refund went out for fifty-five dollars. The note was never written. And the approval landed after the money moved.
> If you deploy agents that only read things, a wrong answer is embarrassing. If they change refunds, tickets or inventory, it is an incident. So teams check by hand — the summary, the tool log, then the database. That does not scale.

## 0:41 – 1:05 · The frontier baseline, scoring perfectly

*74 words in 24 s — **8 s over, trim this one***

> The obvious fix is to ask a frontier model to grade it. That is our baseline, and it is a fair one.
> It gets the same task, the same final response, the same trajectory, and both state snapshots. Its prompt was frozen before StateProof existed.
> And it is good. Perfect diagnosis on every case. But it spends one frontier evaluation per run: across twelve cases, twelve calls and a hundred and twenty-five thousand tokens.

## 1:08 – 1:30 · PBH-B03: the task, and what the agent reported

*17 words in 22 s — 15 s of headroom*

> Here is one real execution. This is the task. This is what the agent said about it.

## 1:30 – 2:00 · Verify this run: FAIL, zero model calls

*21 words in 30 s — 21 s of headroom*

> Watch what happens when I verify it.
> Fail. Five requirements checked, three contradicted. Zero model calls, zero tokens, about one millisecond.

## 2:00 – 2:22 · 55.00 against a required 40.00; the missing note

*17 words in 22 s — 15 s of headroom*

> The refund record says fifty-five dollars. The contract required exactly forty. The support note is simply absent.

## 2:22 – 2:42 · Approval at seq 12, refund executed at seq 8

*32 words in 20 s — 6 s of headroom*

> And the ordering. Approval at sequence twelve. The refund executed at sequence eight.
> The refund call carried an approval reference, so the log looked compliant. Only the order of events settles it.

## 2:45 – 3:15 · Compile once, then verify by code

*71 words in 30 s — **0 s over, trim this one***

> Interpreting a task is the genuinely model-shaped work, so we do it once. A Contract Agent turns the task into typed, checkable requirements before it has seen any run.
> That contract is cached by a fingerprint over the task, the tools and the schema. After that, every run is checked by code — state, event order, prohibitions and scope. Each citation is generated from the record or event that actually matched.

## 3:18 – 3:50 · 12 → 3 → 0 model calls at equal measured quality

*78 words in 32 s — **1 s over, trim this one***

> Twelve synthetic cases. Eight we developed against, four held out and run exactly once after we froze the source.
> On quality it is a tie: full recall, no false violations, complete diagnosis. What is not a tie is the cost. Twelve calls become three on first deployment — seventy-five percent fewer — and seventy-six point one percent fewer tokens. Every run after that is zero and zero.
> Twelve synthetic refund-operations cases. That is not a universal generalization claim.

## 3:53 – 4:27 · v1 and v2 failed; v3 added existential matching

*86 words in 34 s — **3 s over, trim this one***

> Two of our own versions failed, and both are in the submission.
> Version one could not express relational scope — only the support case for this order may change. Version two fixed that and broke something else: it picked outbound messages by recipient alone, and a pre-existing email to the same person made the check ambiguous.
> That exact-one selector was removed. Version three replaced it with existential matching, plus a lint that refuses an under-specified selector before it can run. That is the change that mattered.

## 4:30 – 4:54 · Sample import verifies PASS with no credential

*21 words in 24 s — 15 s of headroom*

> You can bring your own run. This sample goes through the same validator, then verifies — passing, with no model call.

## 4:54 – 5:12 · Every model call, with its exact input envelope

*22 words in 18 s — 9 s of headroom*

> Every model call we made is published with its exact input envelope, retries included. Repeated verification needs no API key at all.

## 5:12 – 5:26 · The hot take

*21 words in 14 s — 5 s of headroom*

> For action-taking agents, the final answer is a claim — not evidence. Compile success once, then verify the state left behind.

---

## Pronunciation and delivery

| | |
| --- | --- |
| `PBH-B03` | say "case B-oh-three" if you say it at all; it is on screen |
| `125,154` | "a hundred and twenty-five thousand" — do not read the exact figure |
| `76.1%` | "seventy-six point one percent" |
| `seq 8 / seq 12` | "sequence eight", "sequence twelve" |
| `StateProof` | one word, even stress |
| `pace` | roughly 140 words per minute; the picture has room, do not rush |
| `the three numbers` | slow down on fifty-five/forty and twelve/eight — they are the point |

## Recording

- 48 kHz WAV, mono or stereo
- Quiet room; no aggressive noise reduction — the mux normalises loudness
- Leave **one second of silence** at the start; the mux trims it
- One continuous take is fine: the mux does not cut on section boundaries
- Save as `video/input/voiceover.wav`

```bash
pnpm video:mux -- --audio video/input/voiceover.wav
```

If the read is more than six seconds off the picture, the mux stops and
writes `video/output/voiceover-mismatch-report.md` rather than quietly
stretching your voice to fit.
