import type { BenchmarkView, DemoSummary, ImportResult, RunView } from '../shared/types';
import { append, clear, el, frag, highlight, ms, pill } from './dom';

/**
 * Rendering. Structural DOM only — no template strings reach the page — so an
 * imported task instruction or agent response cannot become markup.
 */

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
    { class: 'req reveal' },
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
        : el('p', { class: 'small', style: 'margin:0 0 8px' }, requirement.description),
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
    { class: 'timeline card', id: 'timeline', style: 'padding:0' },
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
              { class: 'diff-head', style: 'padding:0 0 6px' },
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

export function runInspector(run: RunView): DocumentFragment {
  const exportBase = `/api/runs/${run.runId}/export`;

  return frag(
    el(
      'section',
      {},
      el(
        'div',
        { class: 'req-head', style: 'padding:0 0 12px' },
        pill(run.verdict, { solid: true }),
        el('h1', { style: 'margin:0' }, run.label),
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
      el(
        'p',
        { style: 'margin-top:12px' },
        el('a', { class: 'btn', href: `${exportBase}?format=json` }, 'Export evidence (JSON)'),
        ' ',
        el('a', { class: 'btn ghost', href: `${exportBase}?format=md` }, 'Export evidence (Markdown)'),
      ),
    ),

    el('section', {}, contrastPanel(run)),

    el(
      'section',
      {},
      el('h2', {}, 'Original task'),
      el('div', { class: 'card' }, el('p', { style: 'margin:0' }, run.task)),
    ),

    el(
      'section',
      {},
      el('h2', {}, `Requirements (${String(run.requirements.length)})`),
      ...run.requirements.map(requirementCard),
    ),

    el(
      'section',
      {},
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
      {},
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
      {},
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
            { class: 'callout warn', style: 'margin-top:12px' },
            el('h3', {}, 'Ambiguities the contract declared'),
            el('ul', {}, ...run.contract.ambiguities.map((item) => el('li', { class: 'small' }, item))),
          ),
    ),
  );
}

export function homeView(benchmark: BenchmarkView | null): DocumentFragment {
  const combined =
    benchmark === null
      ? null
      : (benchmark.splits.find((split) => split.label.startsWith('Combined')) ?? null);
  const usage = benchmark?.usage ?? [];

  return frag(
    el(
      'section',
      { class: 'grid grid-2' },
      el(
        'div',
        {},
        el('h1', {}, 'The agent said it was done. Prove it.'),
        el(
          'p',
          { class: 'lede' },
          'StateProof compiles an agent task into a reusable executable contract, then verifies every run against real state and trajectory evidence — without paying another frontier model to reinterpret the same task each time.',
        ),
        el(
          'p',
          {},
          el('a', { class: 'btn', href: '#/demo' }, 'Run the verification demo'),
          ' ',
          el('a', { class: 'btn ghost', href: '#/import' }, 'Import an agent run'),
        ),
        el(
          'p',
          { class: 'faint small' },
          'The demo needs no API key and makes no model call.',
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, 'The final answer is a claim'),
        el(
          'p',
          { class: 'small muted' },
          'State and process are the evidence. A confident summary and a clean tool log can both be present while the work is wrong — a no-op, the wrong amount, an approval recorded after the money moved.',
        ),
        el('h3', { style: 'margin-top:14px' }, 'How it works'),
        el(
          'ol',
          { class: 'steps', style: 'margin-top:8px' },
          el('li', {}, el('strong', {}, 'Compile the success contract.'), ' Once per task, before any run is seen.'),
          el('li', {}, el('strong', {}, 'Inspect trajectory and state.'), ' Deterministic code, no model in the loop.'),
          el('li', {}, el('strong', {}, 'Produce an evidence-backed verdict.'), ' Every citation points at a real record or event.'),
        ),
      ),
    ),
    combined === null || benchmark === null
      ? el(
          'section',
          {},
          el(
            'div',
            { class: 'callout warn' },
            el('p', { style: 'margin:0' }, 'Benchmark results are unavailable: run `pnpm submission:finalize`.'),
          ),
        )
      : el(
          'section',
          {},
          el('h2', {}, 'Verified benchmark result'),
          el(
            'div',
            { class: 'grid grid-3' },
            el(
              'div',
              { class: 'card' },
              el('h3', {}, 'Quality, all 12 cases'),
              el('p', { class: 'stat' }, combined.stateproof['SVR'] ?? '—'),
              el('p', { class: 'small faint' }, 'Safety Violation Recall, matching the frontier baseline.'),
            ),
            el(
              'div',
              { class: 'card' },
              el('h3', {}, 'First deployment'),
              el('p', { class: 'stat' }, usage[1]?.modelCalls ?? '—'),
              el(
                'p',
                { class: 'small faint' },
                `model calls, against ${usage[0]?.modelCalls ?? '—'} for the baseline.`,
              ),
            ),
            el(
              'div',
              { class: 'card' },
              el('h3', {}, 'Every repeat after that'),
              el('p', { class: 'stat' }, usage[2]?.modelCalls ?? '—'),
              el('p', { class: 'small faint' }, 'model calls, and zero tokens.'),
            ),
          ),
          el(
            'div',
            { class: 'callout', style: 'margin-top:14px' },
            el('p', { style: 'margin:0' }, benchmark.scopeNote),
          ),
          el('p', {}, el('a', { href: '#/benchmark' }, 'See the full comparison →')),
        ),
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
      el('div', { class: 'card' }, el('h3', {}, 'Original task'), el('p', { style: 'margin:0' }, summary.task)),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, "The agent's final claim"),
        el('p', { style: 'margin:0' }, summary.agentClaim),
        el('p', { class: 'faint small', style: 'margin-top:8px' }, 'This is the artefact a human would normally read.'),
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
      el('p', { style: 'margin-top:16px' }, button),
      el('p', { class: 'faint small' }, `Case ${summary.caseId}. ${summary.whyThisCase}`),
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
      ...result.warnings.map((warning) => el('p', { class: 'small', style: 'color:var(--review)' }, warning)),
      el('p', { class: 'muted' }, result.nextAction),
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
        { class: 'table-wrap', style: 'margin-bottom:18px' },
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
      el('p', { class: 'lede' }, benchmark.scopeNote),
      el(
        'p',
        { class: 'faint small' },
        `Every value is read from ${benchmark.generatedFrom}. Nothing on this page is entered by hand.`,
      ),
    ),
    el('section', {}, ...benchmark.splits.map(splitTable)),
    el(
      'section',
      {},
      el('h2', {}, 'Model usage across the full suite'),
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
        { style: 'margin-top:12px' },
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
            el('h3', { style: 'margin-bottom:2px' }, entry.title),
            el('p', { class: 'small muted', style: 'margin:0' }, entry.outcome),
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
          { style: 'margin:0' },
          'For raw artifacts — manifests, predictions, raw model responses and compiled contracts — build the static evidence dashboard with ',
          el('code', {}, 'pnpm dashboard:build'),
          '. This product is the interactive surface; that one is the evidence trail.',
        ),
      ),
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
