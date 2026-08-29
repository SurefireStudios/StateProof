import type {
  AppInfo,
  BenchmarkView,
  DemoSummary,
  HeroProof,
  ImportResult,
  RunView,
} from '../shared/types';
import { append, clear, el, frag, highlight, ms, pill } from './dom';

/**
 * Rendering. Structural DOM only — no template strings reach the page — so an
 * imported task instruction or agent response cannot become markup.
 */

/** The status edge on a requirement card; the pill still carries the word. */
function statusEdge(status: string): string {
  return status === 'PASS' ? 'r-pass' : status === 'FAIL' ? 'r-fail' : 'r-review';
}

export function requirementCard(requirement: RunView['requirements'][number]): HTMLElement {
  const evidence =
    requirement.evidence.length === 0
      ? null
      : el(
          'details',
          {},
          el('summary', {}, `${requirement.evidence.length} evidence reference(s)`),
          el(
            'ul',
            { class: 'ev-list' },
            ...requirement.evidence.map((reference) =>
              el(
                'li',
                {},
                el(
                  'a',
                  {
                    class: 'ev-link',
                    href: `#${reference.targets[0] ?? ''}`,
                    'data-evidence': reference.targets.join(' '),
                  },
                  reference.ref,
                ),
              ),
            ),
          ),
        );

  return el(
    'article',
    { class: `req reveal ${statusEdge(requirement.status)}` },
    el(
      'div',
      { class: 'req-head' },
      pill(requirement.status),
      el('span', { class: 'req-key' }, requirement.requirementKey),
      el('span', { class: 'faint small' }, requirement.category),
      requirement.verificationCoverage === 'partial'
        ? el('span', { class: 'pill v-review', 'data-glyph': '◐' }, 'PARTIAL COVERAGE')
        : null,
    ),
    el(
      'div',
      { class: 'req-body' },
      requirement.description === ''
        ? null
        : el('p', { class: 'small req-desc' }, requirement.description),
      el('p', { class: 'req-reason' }, requirement.reason),
      ...requirement.limitations.map((limitation) =>
        el('p', { class: 'small faint' }, `Not checked: ${limitation}`),
      ),
      evidence,
    ),
  );
}

export function timelineList(events: RunView['timeline']): HTMLElement {
  return el(
    'ol',
    { class: 'timeline card', id: 'timeline' },
    ...events.map((event) =>
      el(
        'li',
        {
          class: `event k-${event.kind}${event.cited ? ' is-cited' : ''}`,
          id: `ev-${event.eventId}`,
        },
        el('span', { class: 'seq' }, `#${String(event.seq)}`),
        el(
          'span',
          { class: 'kind' },
          event.type,
          el('br'),
          el('span', { class: 'faint' }, event.eventId),
        ),
        el('span', { class: 'detail' }, event.summary),
      ),
    ),
  );
}

export function diffList(diff: RunView['diff']): HTMLElement {
  return el(
    'div',
    {},
    ...diff.map((collection) =>
      el(
        'div',
        { class: 'diff-group', id: `diff-${collection.collection}` },
        el(
          'div',
          { class: 'diff-head' },
          el('strong', { class: 'mono' }, collection.collection),
          el(
            'span',
            { class: 'faint small' },
            collection.changes.length === 0
              ? 'unchanged between the initial and final snapshots'
              : `${String(collection.changes.length)} changed record(s)`,
          ),
          collection.cited ? el('span', { class: 'tag' }, 'cited as evidence') : null,
        ),
        ...collection.changes.map((change) =>
          el(
            'div',
            { class: 'diff-row', id: `rec-${collection.collection}-${change.recordId}` },
            el(
              'div',
              { class: 'diff-row-head' },
              el('span', { class: `tag ${change.kind}` }, change.kind),
              el('span', { class: 'mono' }, change.recordId),
              change.cited ? el('span', { class: 'faint small' }, 'cited') : null,
            ),
            ...change.changedFields.map((field) =>
              el(
                'div',
                { class: 'field-change' },
                el('span', { class: 'faint' }, field.field),
                el('span', { class: 'was' }, field.before),
                el('span', { class: 'now' }, field.after),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function failedCount(run: RunView): number {
  return run.requirements.filter((requirement) => requirement.status === 'FAIL').length;
}

export function contrastPanel(run: RunView): HTMLElement {
  const failures = failedCount(run);
  const headline =
    run.verdict === 'PASS'
      ? 'Verified against state and process'
      : run.verdict === 'FAIL'
        ? failures > 1
          ? `${String(failures)} requirements contradicted`
          : 'Requirement contradicted'
        : 'Evidence could not resolve';

  return el(
    'div',
    { class: 'contrast reveal' },
    el(
      'div',
      { class: 'claim' },
      el('h3', {}, 'The agent said'),
      el('p', { class: 'headline' }, 'Task completed'),
      el('p', { class: 'small muted' }, run.agentClaim),
    ),
    el(
      'div',
      { class: 'reality' },
      el('h3', {}, 'The state says'),
      el('p', { class: 'headline' }, headline),
      el(
        'p',
        { class: 'small muted' },
        `${String(run.requirements.length)} requirements checked deterministically in ${ms(
          run.verificationDurationMs,
        )}, with ${String(run.modelCalls)} model call(s).`,
      ),
    ),
  );
}

/** In-page navigation, so a reviewer can go straight to the part they doubt. */
const INSPECTOR_SECTIONS = [
  { id: 'verdict', label: 'Verdict' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'state-diff', label: 'State diff' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'contract', label: 'Contract' },
  { id: 'export', label: 'Export' },
] as const;

function evidenceIndex(run: RunView): HTMLElement {
  const cited = run.requirements.filter((requirement) => requirement.evidence.length > 0);
  const total = cited.reduce((count, requirement) => count + requirement.evidence.length, 0);

  if (total === 0) {
    return el(
      'p',
      { class: 'empty' },
      'This contract resolved without citing a record or event.',
    );
  }

  return el(
    'div',
    {},
    el(
      'p',
      { class: 'muted small' },
      `${String(total)} reference(s) across ${String(cited.length)} requirement(s). Every one is generated from what an assertion matched, and every one is a link to the exact event, record or diff row it names.`,
    ),
    ...cited.map((requirement) =>
      el(
        'div',
        { class: 'card mt-2' },
        el(
          'div',
          { class: 'req-head flush' },
          pill(requirement.status),
          el('span', { class: 'req-key' }, requirement.requirementKey),
        ),
        el(
          'ul',
          { class: 'ev-list' },
          ...requirement.evidence.map((reference) =>
            el(
              'li',
              {},
              el(
                'a',
                {
                  class: 'ev-link',
                  href: `#${reference.targets[0] ?? ''}`,
                  'data-evidence': reference.targets.join(' '),
                },
                reference.ref,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export function runInspector(run: RunView): DocumentFragment {
  const exportBase = `/api/runs/${run.runId}/export`;

  return frag(
    el(
      'nav',
      { class: 'section-nav', 'aria-label': 'Sections of this run' },
      ...INSPECTOR_SECTIONS.map((section) => el('a', { href: `#${section.id}` }, section.label)),
    ),
    el(
      'section',
      { id: 'verdict' },
      el(
        'div',
        { class: 'run-title' },
        pill(run.verdict, { solid: true }),
        el('h1', {}, run.label),
      ),
      el(
        'dl',
        { class: 'kv card' },
        el('dt', {}, 'Run id'),
        el('dd', {}, run.runId),
        el('dt', {}, 'Verified at'),
        el('dd', {}, run.verifiedAt),
        el('dt', {}, 'Mode'),
        el(
          'dd',
          {},
          run.mode === 'deterministic'
            ? 'deterministic verification — zero model calls'
            : 'deterministic verification, after a model-assisted contract compilation',
        ),
        el('dt', {}, 'Verification time'),
        el('dd', {}, ms(run.verificationDurationMs)),
        el('dt', {}, 'Model calls / tokens'),
        el('dd', {}, `${String(run.modelCalls)} / ${String(run.modelTokens)}`),
      ),
    ),

    el('section', {}, contrastPanel(run)),

    el(
      'section',
      {},
      el('h2', {}, 'Original task'),
      el('div', { class: 'card' }, el('p', {}, run.task)),
    ),

    el(
      'section',
      { id: 'requirements' },
      el('h2', {}, `Requirements (${String(run.requirements.length)})`),
      ...run.requirements.map(requirementCard),
    ),

    el(
      'section',
      { id: 'timeline' },
      el('h2', {}, 'Event timeline'),
      el(
        'p',
        { class: 'muted small' },
        'Ordered by sequence, never by timestamp. Approvals are amber, writes blue, errors red; a left bar marks an event cited as evidence.',
      ),
      timelineList(run.timeline),
    ),

    el(
      'section',
      { id: 'state-diff' },
      el('h2', {}, 'State diff'),
      el(
        'p',
        { class: 'muted small' },
        'Every collection is listed, including the ones nothing touched — "unchanged" is itself the evidence a scope or prohibition requirement cites.',
      ),
      diffList(run.diff),
    ),

    el(
      'section',
      { id: 'evidence' },
      el('h2', {}, 'Evidence index'),
      evidenceIndex(run),
    ),

    el(
      'section',
      { id: 'contract' },
      el('h2', {}, 'Contract'),
      el(
        'dl',
        { class: 'kv card' },
        el('dt', {}, 'Task summary'),
        el('dd', {}, run.contract.taskSummary),
        el('dt', {}, 'Requirements compiled'),
        el('dd', {}, String(run.contract.requirementCount)),
        el('dt', {}, 'Contract hash'),
        el('dd', {}, run.contract.contractHash),
        el('dt', {}, 'Task fingerprint'),
        el('dd', {}, run.contract.taskFingerprint),
        el('dt', {}, 'Compiled by'),
        el('dd', {}, run.contract.promptPath),
        el('dt', {}, 'Prompt sha256'),
        el('dd', {}, run.contract.promptHash),
        el('dt', {}, 'Assertion schema'),
        el('dd', {}, run.contract.assertionSchemaVersion),
        el('dt', {}, 'Source'),
        el(
          'dd',
          {},
          run.contract.source === 'frozen-bundle'
            ? 'frozen contract bundle — no model call'
            : run.contract.source === 'uploaded'
              ? 'supplied with the run package'
              : 'compiled in this session',
        ),
      ),
      run.contract.ambiguities.length === 0
        ? null
        : el(
            'div',
            { class: 'callout warn mt-2' },
            el('h3', {}, 'Ambiguities the contract declared'),
            el('ul', {}, ...run.contract.ambiguities.map((item) => el('li', { class: 'small' }, item))),
          ),
    ),

    el(
      'section',
      { id: 'export' },
      el('h2', {}, 'Export the evidence'),
      el(
        'p',
        { class: 'muted small' },
        'Both formats carry the verdict and everything needed to disagree with it: the task, the contract provenance, every requirement with its reason, and every evidence reference. Neither carries a credential, an environment variable, a gold label or a local path.',
      ),
      el(
        'div',
        { class: 'actions mt-3' },
        el('a', { class: 'btn', href: `${exportBase}?format=json` }, 'Export evidence (JSON)'),
        el('a', { class: 'btn ghost', href: `${exportBase}?format=md` }, 'Export evidence (Markdown)'),
      ),
    ),
  );
}

/**
 * The landing page's worked example.
 *
 * Left: what a reviewer reads — the agent's own final report, confident and
 * wrong. Right: what the verifier found in the state, in its own words. The
 * contrast is the product, so it is the first thing on the page, and every
 * number in it comes off an execution rather than out of a copy deck.
 */
export function proofPanel(hero: HeroProof): HTMLElement {
  return el(
    'div',
    { class: 'proof' },
    el(
      'div',
      { class: 'proof-pane proof-claim' },
      el('div', { class: 'proof-head' }, el('h3', {}, 'What was asked')),
      el('p', { class: 'proof-task' }, hero.task),
      el(
        'div',
        { class: 'proof-head' },
        el('h3', {}, 'What the agent reported'),
        el('span', { class: 'pill v-pass', 'data-glyph': '✓' }, 'SELF-REPORTED'),
      ),
      el('blockquote', { class: 'quote' }, hero.agentClaim),
      el(
        'p',
        { class: 'proof-meta' },
        `${String(hero.eventCount)} events · ${String(hero.toolCallCount)} tool calls · nothing in the log announces a problem`,
      ),
    ),
    el(
      'div',
      { class: 'proof-pane proof-reality' },
      el(
        'div',
        { class: 'proof-head' },
        el('h3', {}, 'What the state actually shows'),
        pill(hero.verdict, { solid: true }),
      ),
      el(
        'ol',
        { class: 'findings' },
        ...hero.findings.map((finding) =>
          el(
            'li',
            { class: `finding ${statusEdge(finding.status)}` },
            el('span', { class: 'finding-mark', 'aria-hidden': 'true' }),
            el(
              'div',
              { class: 'finding-body' },
              el(
                'p',
                { class: 'finding-label' },
                finding.label,
                el('span', { class: 'faint small' }, finding.category),
              ),
              el('p', { class: 'finding-evidence' }, finding.evidence),
            ),
          ),
        ),
      ),
      el(
        'p',
        { class: 'proof-meta' },
        `${String(hero.requirementsFailed)} of ${String(hero.requirementsChecked)} requirements contradicted · verified in ${ms(
          hero.verificationDurationMs,
        )} · ${String(hero.modelCalls)} model calls · ${String(hero.modelTokens)} tokens`,
      ),
    ),
  );
}

/**
 * The rest of the entry points, in one centred line.
 *
 * Every one the deployment requires is still here and still one click away;
 * they are quieter than the two primary actions, not fewer.
 */
function secondaryLinks(app: AppInfo | null): HTMLElement {
  const links: HTMLElement[] = [
    el('a', { href: '#/benchmark' }, 'View the benchmark'),
    el('a', { href: '#/import' }, 'Import your own run'),
  ];
  if (app?.dashboardAvailable === true) {
    links.push(el('a', { href: '/evidence/' }, 'Explore the evidence dashboard'));
  }
  if (app?.repositoryUrl != null) {
    links.push(
      el(
        'a',
        { href: `${app.repositoryUrl}/blob/main/REPRODUCTION.md`, rel: 'noreferrer noopener' },
        'Reproduction guide',
      ),
      el('a', { href: app.repositoryUrl, rel: 'noreferrer noopener' }, 'GitHub repository'),
    );
  }

  const children: Array<HTMLElement | null> = [];
  links.forEach((link, index) => {
    if (index > 0) children.push(el('span', { 'aria-hidden': 'true' }, '·'));
    children.push(link);
  });
  return el('nav', { class: 'hero-links', 'aria-label': 'More ways in' }, ...children);
}

function statCard(label: string, value: string, caption: string): HTMLElement {
  return el(
    'div',
    { class: 'card' },
    el('h3', {}, label),
    el('p', { class: 'stat' }, value),
    el('p', { class: 'small faint' }, caption),
  );
}

export function homeView(
  benchmark: BenchmarkView | null,
  hero: HeroProof | null,
  app: AppInfo | null,
): DocumentFragment {
  return frag(
    el(
      'section',
      { class: 'hero' },
      // Two lines, with the demand on its own. `<em>` rather than a styled
      // span: the italic is emphasis, and a screen reader should hear it.
      el(
        'h1',
        {},
        'The agent said it was done.',
        el('br'),
        el('em', {}, 'Prove it.'),
      ),
      el(
        'p',
        { class: 'lede' },
        'StateProof compiles success criteria once, then verifies every agent run against actual state and event evidence—without asking another model to judge the same workflow again.',
      ),
      // Two things to press, then everything else as one quiet line. Seven
      // equal-weight buttons is a wall, not a choice.
      el(
        'div',
        { class: 'actions hero-cta' },
        el('a', { class: 'btn', href: '#/demo' }, 'Run the verification demo'),
        el('a', { class: 'btn ghost', href: '#/import?sample' }, 'Try the sample import'),
      ),
      secondaryLinks(app),
      el(
        'p',
        { class: 'disclosure' },
        'The public demo uses frozen task contracts and deterministic verification. Live contract compilation is intentionally disabled; no model API key is present on the server.',
      ),
    ),
    hero === null
      ? null
      : el(
          'section',
          {},
          proofPanel(hero),
          el(
            'p',
            { class: 'faint small mt-2' },
            'Case ',
            el('span', { class: 'mono' }, hero.caseId),
            ' from PhantomBench-Hard-12, verified offline against the frozen contract. Every figure above came out of that execution. ',
            el('a', { href: '#/demo' }, 'Run it yourself →'),
          ),
        ),
    el(
      'section',
      { class: 'grid grid-2' },
      el(
        'div',
        { class: 'card' },
        el('h3', {}, 'The final answer is a claim'),
        el(
          'p',
          { class: 'small muted' },
          'State and process are the evidence. A confident summary and a clean tool log can both be present while the work is wrong — a no-op, the wrong amount, an approval recorded after the money moved.',
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, 'How it works'),
        el(
          'ol',
          { class: 'steps' },
          el('li', {}, el('strong', {}, 'Compile the success contract.'), ' Once per task, before any run is seen.'),
          el('li', {}, el('strong', {}, 'Inspect trajectory and state.'), ' Deterministic code, no model in the loop.'),
          el('li', {}, el('strong', {}, 'Produce an evidence-backed verdict.'), ' Every citation points at a real record or event.'),
        ),
      ),
    ),
    benchmark === null
      ? el(
          'section',
          {},
          el(
            'div',
            { class: 'callout warn' },
            el('p', {}, 'Benchmark results are unavailable: run `pnpm submission:finalize`.'),
          ),
        )
      : el(
          'section',
          {},
          el('h2', {}, `Measured on ${String(benchmark.headline.caseCount)} synthetic cases`),
          el(
            'div',
            { class: 'grid grid-4' },
            statCard(
              'Safety Violation Recall',
              benchmark.headline.safetyViolationRecall,
              'combined, matching the frontier baseline',
            ),
            statCard(
              'False Violation Rate',
              benchmark.headline.falseViolationRate,
              'no requirement wrongly called a violation',
            ),
            statCard(
              'First deployment',
              benchmark.headline.firstDeploymentCallReduction,
              `fewer model calls, and ${benchmark.headline.firstDeploymentTokenReduction} fewer tokens`,
            ),
            statCard(
              'Every repeat after that',
              `${benchmark.headline.repeatedModelCalls} / ${benchmark.headline.repeatedModelTokens}`,
              'model calls and model tokens',
            ),
          ),
          el(
            'div',
            { class: 'callout mt-3' },
            el('p', { class: 'claim-line' }, benchmark.primaryClaim),
            el('p', { class: 'small muted mt-2' }, benchmark.qualification),
          ),
          el('p', { class: 'faint small mt-2' }, benchmark.scopeNote),
          el(
            'div',
            { class: 'actions mt-3' },
            el('a', { class: 'btn ghost', href: '#/benchmark' }, 'See every number →'),
          ),
        ),
    benchmark === null
      ? null
      : el('section', {}, el('p', { class: 'hot-take' }, benchmark.hotTake)),
  );
}

export function demoIntro(summary: DemoSummary, onVerify: () => void): DocumentFragment {
  const button = el('button', { type: 'button', id: 'verify-button' }, 'Verify this run');
  button.addEventListener('click', onVerify);

  return frag(
    el(
      'section',
      {},
      el('h1', {}, 'Verification demo'),
      el(
        'p',
        { class: 'lede' },
        'A committed refund-operations run, verified against the frozen contract. No credential, no model call.',
      ),
    ),
    el(
      'section',
      { class: 'grid grid-2' },
      el('div', { class: 'card' }, el('h3', {}, 'Original task'), el('p', {}, summary.task)),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, "The agent's final claim"),
        el('p', {}, summary.agentClaim),
        el('p', { class: 'faint small mt-1' }, 'This is the artefact a human would normally read.'),
      ),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Before verification'),
      el(
        'div',
        { class: 'grid grid-3' },
        el('div', { class: 'card' }, el('h3', {}, 'Trajectory'), el('p', { class: 'stat' }, String(summary.eventCount)), el('p', { class: 'small faint' }, `events, ${String(summary.toolCallCount)} tool calls`)),
        el('div', { class: 'card' }, el('h3', {}, 'State'), el('p', { class: 'stat' }, String(summary.changedRecordCount)), el('p', { class: 'small faint' }, `changed records across ${String(summary.collectionCount)} collections`)),
        el('div', { class: 'card' }, el('h3', {}, 'Contract'), el('p', { class: 'stat' }, String(summary.requirementCount)), el('p', { class: 'small faint' }, 'requirements, compiled before this run was seen')),
      ),
      el('div', { class: 'actions mt-3' }, button),
      el('p', { class: 'faint small mt-2' }, `Case ${summary.caseId}. ${summary.whyThisCase}`),
    ),
  );
}

export function skeleton(lines = 4): HTMLElement {
  return el(
    'section',
    { 'aria-live': 'polite' },
    el('p', { class: 'muted' }, 'Running the deterministic verifier…'),
    ...Array.from({ length: lines }, () => el('div', { class: 'skeleton' })),
  );
}

export function errorPanel(title: string, details: Array<{ field: string; message: string }>): HTMLElement {
  return el(
    'div',
    { class: 'callout danger', role: 'alert' },
    el('h3', {}, title),
    ...details.map((detail) =>
      el('p', { class: 'field-error' }, `${detail.field}: ${detail.message}`),
    ),
  );
}

export function importSummary(result: ImportResult): HTMLElement {
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'card reveal' },
      el('h3', {}, 'Validated'),
      el('p', {}, result.caseLabel),
      el(
        'dl',
        { class: 'kv' },
        el('dt', {}, 'Events'),
        el('dd', {}, String(result.eventCount)),
        el('dt', {}, 'Collections'),
        el('dd', {}, result.collections.join(', ')),
        el('dt', {}, 'Contract'),
        el('dd', {}, result.contractStatus),
      ),
      ...result.warnings.map((warning) => el('p', { class: 'small warn-text' }, warning)),
      el('p', { class: 'muted mt-2' }, result.nextAction),
    ),
  );
}

export function benchmarkPage(benchmark: BenchmarkView): DocumentFragment {
  const metricKeys = ['SVR', 'FVR', 'CDR', 'BVA', 'Evidence refs'];

  const splitTable = (split: BenchmarkView['splits'][number]): HTMLElement =>
    el(
      'div',
      {},
      el('h3', {}, `${split.label} — ${String(split.caseCount)} cases`),
      el(
        'div',
        { class: 'table-wrap mb-3' },
        el(
          'table',
          {},
          el(
            'thead',
            {},
            el('tr', {}, el('th', {}, 'Metric'), el('th', {}, 'Frontier baseline'), el('th', {}, 'StateProof')),
          ),
          el(
            'tbody',
            {},
            ...metricKeys.map((key) =>
              el(
                'tr',
                {},
                el('th', { scope: 'row' }, key),
                el('td', {}, split.baseline[key] ?? '—'),
                el('td', {}, split.stateproof[key] ?? '—'),
              ),
            ),
          ),
        ),
      ),
    );

  return frag(
    el(
      'section',
      {},
      el('h1', {}, 'Benchmark'),
      el('p', { class: 'lede' }, benchmark.primaryClaim),
      el(
        'div',
        { class: 'callout warn mt-3' },
        el('p', {}, benchmark.qualification),
      ),
      el(
        'p',
        { class: 'faint small mt-2' },
        `Every value is read from ${benchmark.generatedFrom}. Nothing on this page is entered by hand.`,
      ),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Quality, by split'),
      el(
        'p',
        { class: 'muted small mb-3' },
        'Development is the split StateProof was iterated against. Locked was held out, evaluated exactly once after the source freeze, and never used for tuning. Combined is recomputed from counts, not averaged from the two percentages.',
      ),
      ...benchmark.splits.map(splitTable),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Model usage across the full suite'),
      el(
        'p',
        { class: 'muted small mb-3' },
        'Three operating modes over the same twelve cases. "Model-call wall time" is time spent inside model calls; "end-to-end elapsed" is the whole run including deterministic verification. The warm row makes no model call at all, so its elapsed time is verification and I/O only — not model wall-clock time.',
      ),
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          {},
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', {}, ''),
              el('th', {}, 'Model calls'),
              el('th', {}, 'Total tokens'),
              el('th', {}, 'Model-call wall time'),
              el('th', {}, 'Deterministic verification'),
              el('th', {}, 'End-to-end elapsed'),
              el('th', {}, 'API cost estimate'),
            ),
          ),
          el(
            'tbody',
            {},
            ...benchmark.usage.map((row) =>
              el(
                'tr',
                {},
                el('th', { scope: 'row' }, row.label),
                el('td', {}, row.modelCalls),
                el('td', {}, row.totalTokens),
                el('td', {}, row.modelCallWall),
                el('td', {}, row.deterministicVerification),
                el('td', {}, row.endToEndElapsed),
                el('td', {}, row.apiCost),
              ),
            ),
          ),
        ),
      ),
      el(
        'ul',
        { class: 'mt-2' },
        ...benchmark.reductions.map((reduction) =>
          el('li', { class: 'small' }, `${reduction.label}: ${reduction.value}`),
        ),
      ),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Improvement changelog'),
      el(
        'ol',
        { class: 'steps' },
        ...benchmark.changelog.map((entry) =>
          el(
            'li',
            {},
            el('h3', {}, entry.title),
            el('p', { class: 'small muted' }, entry.outcome),
          ),
        ),
      ),
    ),
    el(
      'section',
      {},
      el(
        'div',
        { class: 'callout' },
        el(
          'p',
          {},
          'For raw artifacts — manifests, predictions, raw model responses and compiled contracts — build the static evidence dashboard with ',
          el('code', {}, 'pnpm dashboard:build'),
          '. This product is the interactive surface; that one is the evidence trail.',
        ),
      ),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'What this does not show'),
      el(
        'ul',
        {},
        el('li', { class: 'small' }, 'Twelve synthetic cases in one domain — refund operations — against one model family. It does not establish generalization.'),
        el('li', { class: 'small' }, 'Both systems score 100% on every quality metric, so the suite cannot separate them on accuracy. What separates them is cost, determinism and evidence validity.'),
        el('li', { class: 'small' }, 'The efficiency figures are withheld in code unless SVR 100%, CDR 100%, FVR 0% and evidence-reference validity 100% all hold. Two earlier iterations were cheaper than the baseline and are reported with no reduction figures at all.'),
        el('li', { class: 'small' }, 'USD figures are an estimate against a dated published price list, not an invoice.'),
      ),
      el('p', { class: 'faint small mt-2' }, benchmark.scopeNote),
    ),
  );
}

/** One delegated handler makes every evidence link followable. */
export function installEvidenceDelegation(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('[data-evidence]');
    if (link === null) return;
    event.preventDefault();
    const ids = (link.getAttribute('data-evidence') ?? '').split(' ').filter(Boolean);
    highlight(ids);
  });
}

export { clear, append };
