# Teleprompter

Large type, short lines, one idea per line. Section headings are cues, not
spoken. Blank lines are breaths.

---

### [ 0:00 ]

StateProof.

The agent said it was done.

Prove it.


### [ 0:08 ]

An agent reports success.

It refunded forty dollars, emailed the receipt, added the note, and got approval first.

That sentence is a claim.

It is not evidence.

The refund went out for fifty-five dollars.

The note was never written.

And the approval landed after the money moved.

When an agent only reads, a wrong answer is embarrassing.

When it moves money, it is an incident.

So teams check by hand —

summary, tool log, database.

That does not scale.


### [ 0:47 ]

The obvious fix is to ask a frontier model to grade it.

That is our baseline, and it is a fair one.

It gets the same task, the same response, the same trajectory, both state snapshots.

Its prompt was frozen before StateProof existed.

And it is good —

perfect diagnosis on every case.

But it spends one frontier evaluation per run.

Across twelve cases: twelve calls, a hundred and twenty-five thousand tokens.


### [ 1:22 ]

Here is one real execution.

This is the task.

This is what the agent said about it.


### [ 1:35 ]

Watch what happens when I verify it.

Fail.

Five requirements checked, three contradicted.

Zero model calls, zero tokens, about one millisecond.


### [ 1:54 ]

The refund record says fifty-five dollars.

The contract required exactly forty.

The support note is simply absent.


### [ 2:08 ]

And the ordering.

Approval at sequence twelve.

The refund executed at sequence eight.

The refund call carried an approval reference, so the log looked compliant.

Only the order of events settles it.


### [ 2:29 ]

Interpreting a task is the model-shaped work, so we do it once.

A Contract Agent turns the task into typed, checkable requirements before it sees any run.

The contract is cached by task fingerprint.

After that, every run is checked by code —

state, event order, prohibitions, scope.

Every citation comes from a record that actually matched.


### [ 2:58 ]

Twelve synthetic cases.

Eight we developed against, four held out and run exactly once after we froze the source.

On quality it is a tie.

On cost it is not.

Twelve calls become three on first deployment —

seventy-five percent fewer, and seventy-six point one percent fewer tokens.

Every run after that is zero and zero.

Twelve synthetic cases in one domain.

Not a generalization claim.


### [ 3:31 ]

Two of our own versions failed, and both are in the submission.

Version one could not express relational scope —

only the support case for this order may change.

Version two fixed that and broke something else: it picked messages by recipient alone, and an older email to the same person made the check ambiguous.

That exact-one selector was removed.

Version three replaced it with existential matching, and a lint that refuses a vague selector before it runs.

That is the change that mattered.


### [ 4:10 ]

You can bring your own run.

This sample goes through the same validator, then verifies —

passing, with no model call.


### [ 4:25 ]

Every model call is published with its exact input envelope, retries included.

Repeated verification needs no API key.


### [ 4:36 ]

For action-taking agents, the final answer is a claim —

not evidence.

Compile success once, then verify the state left behind.

