/**
 * The shot list, as data.
 *
 * `capture.ts` records these, `render.ts` lays them out and `verify-video.ts`
 * checks the result against them. One definition, so a clip cannot be captured
 * at one length and checked against another.
 */

export interface Clip {
  /** File stem, and the id used in the cue sheet and the verification report. */
  readonly id: string;
  /** What a viewer is meant to take from it. */
  readonly purpose: string;
  /** Path on the deployment, relative to the base URL. */
  readonly route: string;
  /** Seconds the clip should last. The capture script paces itself to this. */
  readonly seconds: number;
  /** Section card shown before this clip, if any. */
  readonly card?: { readonly title: string; readonly subtitle?: string; readonly seconds: number };
}

/**
 * Timings are deliberately generous: narration has to fit inside the picture,
 * and a viewer reading a table needs longer than a viewer watching a click.
 */
export const CLIPS: readonly Clip[] = [
  {
    id: 'problem',
    purpose: 'The claim, and the three things the state says instead',
    route: '/',
    seconds: 36,
  },
  {
    id: 'baseline',
    purpose: 'The frontier baseline, scoring perfectly',
    route: '/benchmark',
    seconds: 33,
    card: { title: 'The fair baseline', subtitle: 'Same task. Same evidence. Same model.', seconds: 2.5 },
  },
  {
    id: 'demo-setup',
    purpose: 'PBH-B03: the task, and what the agent reported',
    route: '/demo',
    seconds: 13,
    card: { title: 'One real execution', subtitle: 'PBH-B03 · refund operations', seconds: 2.5 },
  },
  { id: 'demo-verify', purpose: 'Verify this run: FAIL, zero model calls', route: '/demo', seconds: 19 },
  { id: 'demo-findings', purpose: '55.00 against a required 40.00; the missing note', route: '/demo', seconds: 14 },
  { id: 'demo-timeline', purpose: 'Approval at seq 12, refund executed at seq 8', route: '/demo', seconds: 18 },
  {
    id: 'architecture',
    purpose: 'Compile once, then verify by code',
    route: '/evidence/architecture.html',
    seconds: 27,
    card: { title: 'How it works', seconds: 2.5 },
  },
  {
    id: 'comparison',
    purpose: '12 → 3 → 0 model calls at equal measured quality',
    route: '/benchmark',
    seconds: 30,
    card: { title: 'What it measured', subtitle: '12 synthetic cases · 8 development, 4 held out', seconds: 2.5 },
  },
  {
    id: 'changelog',
    purpose: 'v1 and v2 failed; v3 added existential matching',
    route: '/evidence/changelog.html',
    seconds: 37,
    card: { title: 'What went wrong on the way', seconds: 2.5 },
  },
  {
    id: 'reproduce',
    purpose: 'Sample import verifies PASS with no credential',
    route: '/import?sample',
    seconds: 15,
    card: { title: 'Bring your own run', seconds: 2.5 },
  },
  {
    id: 'traces',
    purpose: 'Every model call, with its exact input envelope',
    route: '/evidence/trajectories.html',
    seconds: 11,
  },
  { id: 'closing', purpose: 'The hot take', route: '/', seconds: 12 },
];

/** Title card at the head of the film. */
export const TITLE_CARD = {
  title: 'StateProof',
  subtitle: 'The agent said it was done. Prove it.',
  byline: 'Stephen Fitzgerald · micro1 Agentic Workflows Hackathon',
  seconds: 8,
};

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;

/** Hard ceiling from the brief. The render fails rather than exceeding it. */
export const MAX_SECONDS = 298;

export function plannedSeconds(): number {
  const cards = CLIPS.reduce((total, clip) => total + (clip.card?.seconds ?? 0), 0);
  const body = CLIPS.reduce((total, clip) => total + clip.seconds, 0);
  return TITLE_CARD.seconds + cards + body;
}
