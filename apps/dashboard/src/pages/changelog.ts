import type { DashboardModel } from '../model';
import { esc, page, percent } from '../shell';

/**
 * The iteration history, with every failed step still in it.
 *
 * Each row links to the artifacts that justify it. A changelog that only lists
 * the wins is a marketing document; this one is meant to be checkable.
 */

interface Row {
  readonly stage: string;
  readonly title: string;
  readonly finding: string;
  readonly outcome: string;
  readonly links: Array<{ label: string; href: string }>;
}

function rows(model: DashboardModel): Row[] {
  const core = model.coreBaseline;
  const artifact = (relativePath: string): string => `../../${relativePath}`;

  return [
    {
      stage: '1',
      title: 'Core-12 diagnostic baseline saturated',
      finding:
        'A frontier evaluator with the full trajectory and both state snapshots classified every ' +
        'Core-12 case correctly. Overall PASS/FAIL accuracy had no headroom left to measure.',
      outcome: core === null ? 'BVA 100%' : `BVA ${percent(core.bva)}`,
      links: [
        ...(core === null
          ? []
          : [
              { label: 'report', href: artifact(core.registered.reportMarkdownPath) },
              { label: 'manifest', href: artifact(core.registered.manifestPath) },
              { label: 'predictions', href: artifact(core.registered.predictionPath) },
            ]),
        { label: 'prompt v1', href: artifact('prompts/baseline-evaluator/v1.md') },
      ],
    },
    {
      stage: '2',
      title: 'Hard-12 requirement-level baseline saturated',
      finding:
        'Requirement-level scoring on a harder suite still did not separate the systems: the ' +
        'frozen frontier baseline reached full recall and complete diagnosis. Accuracy stopped ' +
        'being the interesting axis; cost and determinism started.',
      outcome: `SVR ${percent(model.baseline.svr)} · CDR ${percent(model.baseline.cdr)} · FVR ${percent(model.baseline.fvr)}`,
      links: [
        { label: 'report', href: artifact(model.baseline.registered.reportMarkdownPath) },
        { label: 'manifest', href: artifact(model.baseline.registered.manifestPath) },
        { label: 'predictions', href: artifact(model.baseline.registered.predictionPath) },
        { label: 'prompt v2', href: artifact('prompts/baseline-evaluator/v2.md') },
      ],
    },
    {
      stage: '3',
      title: 'StateProof v1 exposed the DSL limits',
      finding:
        'Compile-once-then-verify worked, and every overall verdict was right. What it lost was ' +
        'diagnosis: the vocabulary could not say "only the support case for this order may ' +
        'change", and a prohibited refund got counted twice — once as a prohibition, once as scope.',
      outcome: `SVR ${percent(model.v1.svr)} · CDR ${percent(model.v1.cdr)} · FVR ${percent(model.v1.fvr)} — no efficiency claimed`,
      links: [
        { label: 'report', href: artifact(model.v1.registered.reportMarkdownPath) },
        { label: 'manifest', href: artifact(model.v1.registered.manifestPath) },
        { label: 'predictions', href: artifact(model.v1.registered.predictionPath) },
        { label: 'prompt v1', href: artifact('prompts/contract-agent/v1.md') },
        { label: 'decision record', href: artifact('docs/decisions/0005-gate-3a.md') },
      ],
    },
    {
      stage: '4',
      title: 'StateProof v2 fixed relational scope and note structure',
      finding:
        'All three v1 defects closed: relational mutation scope, one note carrying both its exact ' +
        'text and its refund reference, and scope no longer duplicating a prohibition. A new ' +
        'defect appeared — outbound messages were identified by recipient alone, so a ' +
        'pre-existing message to the same person made the check unresolvable.',
      outcome: `SVR ${percent(model.v2.svr)} · CDR ${percent(model.v2.cdr)} · BVA ${percent(model.v2.bva)} — warm run withheld`,
      links: [
        { label: 'report', href: artifact(model.v2.registered.reportMarkdownPath) },
        { label: 'manifest', href: artifact(model.v2.registered.manifestPath) },
        { label: 'predictions', href: artifact(model.v2.registered.predictionPath) },
        { label: 'prompt v2', href: artifact('prompts/contract-agent/v2.md') },
        { label: 'decision record', href: artifact('docs/decisions/0006-gate-3b.md') },
      ],
    },
    {
      stage: '5',
      title: 'StateProof v3 added existential matching',
      finding:
        '`record_exists_matching` asks whether a record satisfying every condition exists, instead ' +
        'of selecting one candidate first. A semantic lint refuses a contract that identifies an ' +
        'outbound record by recipient alone. Every guardrail met, with zero repair retries.',
      outcome: `SVR ${percent(model.cold.svr)} · FVR ${percent(model.cold.fvr)} · CDR ${percent(model.cold.cdr)} · BVA ${percent(model.cold.bva)}`,
      links: [
        { label: 'report', href: artifact(model.cold.registered.reportMarkdownPath) },
        { label: 'manifest', href: artifact(model.cold.registered.manifestPath) },
        { label: 'predictions', href: artifact(model.cold.registered.predictionPath) },
        { label: 'prompt v3', href: artifact('prompts/contract-agent/v3.md') },
        { label: 'decision record', href: artifact('docs/decisions/0007-gate-3c.md') },
      ],
    },
    {
      stage: '6',
      title: 'Measured warm verification proved zero-call reuse',
      finding:
        'Three consecutive warm runs from the committed contract bundle, in a child process with ' +
        'no credential in its environment and no .env in its working directory. Byte-identical ' +
        'canonical predictions, identical contract hashes, identical metrics.',
      outcome: `${model.warm.modelCalls} model calls · ${model.warm.totalTokens} tokens · sha256 ${model.warm.canonicalPredictionSha256.slice(0, 16)}`,
      links: [
        { label: 'warm report', href: artifact(model.warm.registered.reportMarkdownPath) },
        { label: 'warm manifest', href: artifact(model.warm.registered.manifestPath) },
        ...model.warmRepeats.map((run, index) => ({
          label: `repeat ${index + 1}`,
          href: artifact(run.registered.predictionPath),
        })),
        { label: 'changelog', href: artifact('IMPROVEMENT_CHANGELOG.md') },
      ],
    },
  ];
}

export function renderChangelog(model: DashboardModel): string {
  const body = `
<section>
  <p class="muted">Six steps, two of which failed their quality guardrails and are kept exactly as
  they ran. Every row links to the report, manifest, predictions, prompt and decision record behind
  it — the raw model responses for each contract are on the
  <a href="trajectories.html">Trajectories</a> page.</p>
</section>

<section>
  <ol class="steps">
    ${rows(model)
      .map(
        (row) => `
      <li>
        <h3 style="margin-bottom:4px">${esc(row.title)}</h3>
        <p class="small muted" style="margin:0 0 8px">${esc(row.finding)}</p>
        <p class="small mono" style="margin:0 0 8px">${esc(row.outcome)}</p>
        <p class="small" style="margin:0">${row.links
          .map((link) => `<a class="ev-link" href="${esc(link.href)}">${esc(link.label)}</a>`)
          .join(' ')}</p>
      </li>`,
      )
      .join('')}
  </ol>
</section>

<section>
  <div class="callout">
    <p style="margin:0">Nothing has been removed from this history. Two of the six steps are
    failures, and they are the reason the final efficiency claim is believable: the same code that
    reports the win withheld it twice.</p>
  </div>
</section>
`;

  return page({
    title: 'Improvement changelog',
    active: 'changelog.html',
    subtitle: 'Every iteration, including the ones that did not work.',
    body,
  });
}
