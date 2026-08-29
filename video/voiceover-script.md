# Voiceover script

Timings are **measured** from the rendered cut.
Total picture: **4:48**. Script: **514 words**, about 3:40 at 140 words per minute.

Read it unhurried. The picture has room, and the three number pairs are the
whole point — slow down on those.

---

## 0:00 – 0:08 · Title card

*9 words in 8 s — 4 s of headroom*

> StateProof. The agent said it was done. Prove it.

## 0:08 – 0:44 · The claim, and the three things the state says instead

*79 words in 36 s — 2 s of headroom*

> An agent reports success. It refunded forty dollars, emailed the receipt, added the note, and got approval first.
> That sentence is a claim. It is not evidence.
> The refund went out for fifty-five dollars. The note was never written. And the approval landed after the money moved.
> When an agent only reads, a wrong answer is embarrassing. When it moves money, it is an incident. So teams check by hand — summary, tool log, database. That does not scale.

## 0:47 – 1:20 · The frontier baseline, scoring perfectly

*72 words in 33 s — 2 s of headroom*

> The obvious fix is to ask a frontier model to grade it. That is our baseline, and it is a fair one.
> It gets the same task, the same response, the same trajectory, both state snapshots. Its prompt was frozen before StateProof existed.
> And it is good — perfect diagnosis on every case. But it spends one frontier evaluation per run. Across twelve cases: twelve calls, a hundred and twenty-five thousand tokens.

## 1:22 – 1:35 · PBH-B03: the task, and what the agent reported

*17 words in 13 s — 6 s of headroom*

> Here is one real execution. This is the task. This is what the agent said about it.

## 1:35 – 1:54 · Verify this run: FAIL, zero model calls

*21 words in 19 s — 10 s of headroom*

> Watch what happens when I verify it.
> Fail. Five requirements checked, three contradicted. Zero model calls, zero tokens, about one millisecond.

## 1:54 – 2:08 · 55.00 against a required 40.00; the missing note

*17 words in 14 s — 7 s of headroom*

> The refund record says fifty-five dollars. The contract required exactly forty. The support note is simply absent.

## 2:08 – 2:26 · Approval at seq 12, refund executed at seq 8

*32 words in 18 s — 4 s of headroom*

> And the ordering. Approval at sequence twelve. The refund executed at sequence eight.
> The refund call carried an approval reference, so the log looked compliant. Only the order of events settles it.

## 2:29 – 2:56 · Compile once, then verify by code

*57 words in 27 s — 3 s of headroom*

> Interpreting a task is the model-shaped work, so we do it once. A Contract Agent turns the task into typed, checkable requirements before it sees any run.
> The contract is cached by task fingerprint. After that, every run is checked by code — state, event order, prohibitions, scope. Every citation comes from a record that actually matched.

## 2:58 – 3:28 · 12 → 3 → 0 model calls at equal measured quality

*66 words in 30 s — 2 s of headroom*

> Twelve synthetic cases. Eight we developed against, four held out and run exactly once after we froze the source.
> On quality it is a tie. On cost it is not. Twelve calls become three on first deployment — seventy-five percent fewer, and seventy-six point one percent fewer tokens. Every run after that is zero and zero.
> Twelve synthetic cases in one domain. Not a generalization claim.

## 3:31 – 4:08 · v1 and v2 failed; v3 added existential matching

*84 words in 37 s — 1 s of headroom*

> Two of our own versions failed, and both are in the submission.
> Version one could not express relational scope — only the support case for this order may change. Version two fixed that and broke something else: it picked messages by recipient alone, and an older email to the same person made the check ambiguous.
> That exact-one selector was removed. Version three replaced it with existential matching, and a lint that refuses a vague selector before it runs. That is the change that mattered.

## 4:10 – 4:25 · Sample import verifies PASS with no credential

*21 words in 15 s — 6 s of headroom*

> You can bring your own run. This sample goes through the same validator, then verifies — passing, with no model call.

## 4:25 – 4:36 · Every model call, with its exact input envelope

*18 words in 11 s — 3 s of headroom*

> Every model call is published with its exact input envelope, retries included. Repeated verification needs no API key.

## 4:36 – 4:48 · The hot take

*21 words in 12 s — 3 s of headroom*

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
