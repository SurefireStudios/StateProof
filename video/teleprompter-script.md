# Teleprompter

Large type, short lines, one idea per line. Section headings are cues, not
spoken. Blank lines are breaths.

---

### [ 0:00 ]

StateProof.

The agent said it was done.

Prove it.


### [ 0:12 ]

An agent just reported success.

It refunded forty dollars, emailed the receipt, added a support note, and got approval first.

That sentence is a claim.

It is not evidence.

The refund went out for fifty-five dollars.

The note was never written.

And the approval landed after the money moved.

If you deploy agents that only read things, a wrong answer is embarrassing.

If they change refunds, tickets or inventory, it is an incident.

So teams check by hand —

the summary, the tool log, then the database.

That does not scale.


### [ 0:41 ]

The obvious fix is to ask a frontier model to grade it.

That is our baseline, and it is a fair one.

It gets the same task, the same final response, the same trajectory, and both state snapshots.

Its prompt was frozen before StateProof existed.

And it is good.

Perfect diagnosis on every case.

But it spends one frontier evaluation per run: across twelve cases, twelve calls and a hundred and twenty-five thousand tokens.


### [ 1:08 ]

Here is one real execution.

This is the task.

This is what the agent said about it.


### [ 1:30 ]

Watch what happens when I verify it.

Fail.

Five requirements checked, three contradicted.

Zero model calls, zero tokens, about one millisecond.


### [ 2:00 ]

The refund record says fifty-five dollars.

The contract required exactly forty.

The support note is simply absent.


### [ 2:22 ]

And the ordering.

Approval at sequence twelve.

The refund executed at sequence eight.

The refund call carried an approval reference, so the log looked compliant.

Only the order of events settles it.


### [ 2:45 ]

Interpreting a task is the genuinely model-shaped work, so we do it once.

A Contract Agent turns the task into typed, checkable requirements before it has seen any run.

That contract is cached by a fingerprint over the task, the tools and the schema.

After that, every run is checked by code —

state, event order, prohibitions and scope.

Each citation is generated from the record or event that actually matched.


### [ 3:18 ]

Twelve synthetic cases.

Eight we developed against, four held out and run exactly once after we froze the source.

On quality it is a tie: full recall, no false violations, complete diagnosis.

What is not a tie is the cost.

Twelve calls become three on first deployment —

seventy-five percent fewer —

and seventy-six point one percent fewer tokens.

Every run after that is zero and zero.

Twelve synthetic refund-operations cases.

That is not a universal generalization claim.


### [ 3:53 ]

Two of our own versions failed, and both are in the submission.

Version one could not express relational scope —

only the support case for this order may change.

Version two fixed that and broke something else: it picked outbound messages by recipient alone, and a pre-existing email to the same person made the check ambiguous.

That exact-one selector was removed.

Version three replaced it with existential matching, plus a lint that refuses an under-specified selector before it can run.

That is the change that mattered.


### [ 4:30 ]

You can bring your own run.

This sample goes through the same validator, then verifies —

passing, with no model call.


### [ 4:54 ]

Every model call we made is published with its exact input envelope, retries included.

Repeated verification needs no API key at all.


### [ 5:12 ]

For action-taking agents, the final answer is a claim —

not evidence.

Compile success once, then verify the state left behind.

