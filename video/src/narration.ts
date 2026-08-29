/**
 * The spoken script, keyed to the clip each line plays over.
 *
 * Captions are generated from this and from the *measured* clip durations, so
 * a caption cannot claim a time the picture does not have. Editing a line here
 * changes the script, the teleprompter and the SRT together.
 *
 * Budget: under ~650 words, short sentences, written to be read aloud.
 */

export interface Line {
  /** Clip id from `clips.ts`, or `title` for the opening card. */
  readonly at: string;
  readonly text: string;
}

export const NARRATION: readonly Line[] = [
  {
    at: 'title',
    text: 'StateProof. The agent said it was done. Prove it.',
  },

  {
    at: 'problem',
    text: 'An agent reports success. It refunded forty dollars, emailed the receipt, added the note, and got approval first.',
  },
  {
    at: 'problem',
    text: 'That sentence is a claim. It is not evidence.',
  },
  {
    at: 'problem',
    text: 'The refund went out for fifty-five dollars. The note was never written. And the approval landed after the money moved.',
  },
  {
    at: 'problem',
    text: 'When an agent only reads, a wrong answer is embarrassing. When it moves money, it is an incident. So teams check by hand — summary, tool log, database. That does not scale.',
  },

  {
    at: 'baseline',
    text: 'The obvious fix is to ask a frontier model to grade it. That is our baseline, and it is a fair one.',
  },
  {
    at: 'baseline',
    text: 'It gets the same task, the same response, the same trajectory, both state snapshots. Its prompt was frozen before StateProof existed.',
  },
  {
    at: 'baseline',
    text: 'And it is good — perfect diagnosis on every case. But it spends one frontier evaluation per run. Across twelve cases: twelve calls, a hundred and twenty-five thousand tokens.',
  },

  {
    at: 'demo-setup',
    text: 'Here is one real execution. This is the task. This is what the agent said about it.',
  },
  {
    at: 'demo-verify',
    text: 'Watch what happens when I verify it.',
  },
  {
    at: 'demo-verify',
    text: 'Fail. Five requirements checked, three contradicted. Zero model calls, zero tokens, about one millisecond.',
  },
  {
    at: 'demo-findings',
    text: 'The refund record says fifty-five dollars. The contract required exactly forty. The support note is simply absent.',
  },
  {
    at: 'demo-timeline',
    text: 'And the ordering. Approval at sequence twelve. The refund executed at sequence eight.',
  },
  {
    at: 'demo-timeline',
    text: 'The refund call carried an approval reference, so the log looked compliant. Only the order of events settles it.',
  },

  {
    at: 'architecture',
    text: 'Interpreting a task is the model-shaped work, so we do it once. A Contract Agent turns the task into typed, checkable requirements before it sees any run.',
  },
  {
    at: 'architecture',
    text: 'The contract is cached by task fingerprint. After that, every run is checked by code — state, event order, prohibitions, scope. Every citation comes from a record that actually matched.',
  },

  {
    at: 'comparison',
    text: 'Twelve synthetic cases. Eight we developed against, four held out and run exactly once after we froze the source.',
  },
  {
    at: 'comparison',
    text: 'On quality it is a tie. On cost it is not. Twelve calls become three on first deployment — seventy-five percent fewer, and seventy-six point one percent fewer tokens. Every run after that is zero and zero.',
  },
  {
    at: 'comparison',
    text: 'Twelve synthetic cases in one domain. Not a generalization claim.',
  },

  {
    at: 'changelog',
    text: 'Two of our own versions failed, and both are in the submission.',
  },
  {
    at: 'changelog',
    text: 'Version one could not express relational scope — only the support case for this order may change. Version two fixed that and broke something else: it picked messages by recipient alone, and an older email to the same person made the check ambiguous.',
  },
  {
    at: 'changelog',
    text: 'That exact-one selector was removed. Version three replaced it with existential matching, and a lint that refuses a vague selector before it runs. That is the change that mattered.',
  },

  {
    at: 'reproduce',
    text: 'You can bring your own run. This sample goes through the same validator, then verifies — passing, with no model call.',
  },
  {
    at: 'traces',
    text: 'Every model call is published with its exact input envelope, retries included. Repeated verification needs no API key.',
  },

  {
    at: 'closing',
    text: 'For action-taking agents, the final answer is a claim — not evidence. Compile success once, then verify the state left behind.',
  },
];

export function wordCount(): number {
  return NARRATION.reduce((total, line) => total + line.text.split(/\s+/).filter(Boolean).length, 0);
}

/** Pronunciation and delivery notes for the teleprompter. */
export const NOTES: ReadonlyArray<readonly [string, string]> = [
  ['PBH-B03', 'say "case B-oh-three" if you say it at all; it is on screen'],
  ['125,154', '"a hundred and twenty-five thousand" — do not read the exact figure'],
  ['76.1%', '"seventy-six point one percent"'],
  ['seq 8 / seq 12', '"sequence eight", "sequence twelve"'],
  ['StateProof', 'one word, even stress'],
  ['pace', 'roughly 140 words per minute; the picture has room, do not rush'],
  ['the three numbers', 'slow down on fifty-five/forty and twelve/eight — they are the point'],
];
