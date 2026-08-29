import {
  CLAUDE_OPUS_5_PRICING,
  type LoadedRun,
  type MetricView,
  estimateCostUsd,
  formatUsd,
} from '@stateproof/submission';
import type { DashboardModel } from '../model';
import { esc, integer, page, percent, seconds } from '../shell';

/**
 * The comparison page, including the two iterations that failed.
 *
 * Deleting them would make the story cleaner and the evidence worse: the whole
 * argument is that quality gates the efficiency claim, and that argument is only
 * legible if you can see the runs where the gate held.
 */

function guardrailCell(run: LoadedRun): string {
  return run.guardrailsMet
    ? '<span class="pill v-pass">MET</span>'
    : '<span class="pill v-review">NOT MET</span>';
}

function bar(value: number | null, max: number): string {
  if (value === null || max === 0) return '';
  const width = Math.max(1, Math.round((value / max) * 100));
  return `<div class="bar" style="margin-top:5px"><span style="width:${width}%"></span></div>`;
}

function metricRow(label: string, runs: LoadedRun[], pick: (run: LoadedRun) => string): string {
  return `<tr><th scope="row">${esc(label)}</th>${runs
    .map((run) => `<td class="num">${pick(run)}</td>`)
    .join('')}</tr>`;
}

function failureMatrix(model: DashboardModel): string {
  const rows = model.cases
    .map((caseView) => {
      const scored = caseView.stateproofScored;
      const baseline = caseView.baseline;
      const cell = (verdict: string | undefined, correct: boolean | undefined): string => {
        if (verdict === undefined) return '<td>—</td>';
        const mark = correct === true ? '✓' : '✗';
        const cls = correct === true ? 'v-pass' : 'v-fail';
        return `<td><span class="${cls}">${esc(mark)}</span> <span class="mono small">${esc(verdict)}</span></td>`;
      };
      return `<tr>
        <td class="mono">${esc(caseView.caseId)}</td>
        <td class="mono small">${esc(scored?.goldVerdict ?? '—')}</td>
        ${cell(baseline?.verdict, baseline?.correct)}
        ${cell(caseView.verdict, scored?.correct)}
        <td class="mono small">${esc(scored?.goldFailedKeys.join(', ') ?? '—') || '—'}</td>
        <td class="mono small">${esc(scored?.missedKeys.join(', ') ?? '') || '<span class="faint">none</span>'}</td>
        <td class="mono small">${esc(scored?.falselyFailedKeys.join(', ') ?? '') || '<span class="faint">none</span>'}</td>
      </tr>`;
    })
    .join('');

  return `<div class="table-wrap">
    <table>
      <thead><tr>
        <th>Case</th><th>Gold</th><th>Baseline</th><th>StateProof v3</th>
        <th>Gold-failed requirements</th><th>Missed</th><th>False failures</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** The three evaluation views, side by side, once the locked run exists. */
function finalViews(model: DashboardModel): string {
  const final = model.final;
  if (final === null) {
    return `
<section>
  <h2>Locked and combined results</h2>
  <div class="callout warn">
    <p style="margin:0"><strong>No final evaluation document is present in this build</strong>, so
    the locked and combined tables have nothing to read. Nothing is shown here rather than a
    placeholder, because a table that renders before the measurement exists is the failure this
    project is about.</p>
  </div>
</section>`;
  }

  const rows: Array<[string, (view: MetricView) => string]> = [
    ['Safety Violation Recall', (view) => `${percent(view.safetyViolationRecall)} <span class="faint">(${view.safetyViolationCounts[0]}/${view.safetyViolationCounts[1]})</span>`],
    ['False Violation Rate', (view) => `${percent(view.falseViolationRate)} <span class="faint">(${view.falseViolationCounts[0]}/${view.falseViolationCounts[1]})</span>`],
    ['Complete Diagnosis Rate', (view) => `${percent(view.completeDiagnosisRate)} <span class="faint">(${view.completeDiagnosisCounts[0]}/${view.completeDiagnosisCounts[1]})</span>`],
    ['Balanced Verdict Accuracy', (view) => percent(view.balancedVerdictAccuracy)],
    ['Valid Run Acceptance', (view) => percent(view.validRunAcceptanceRate)],
    ['Invalid Run Rejection', (view) => percent(view.invalidRunRejectionRate)],
    ['Unsafe false completion', (view) => percent(view.unsafeFalseCompletionRate)],
    ['NEEDS_REVIEW frequency', (view) => percent(view.needsReviewRate)],
    ['Assessment completeness', (view) => percent(view.assessmentCompleteness)],
    ['Evidence-reference validity', (view) => `${percent(view.evidenceRefValidity)} <span class="faint">(${view.evidenceRefCounts[0]}/${view.evidenceRefCounts[1]})</span>`],
  ];

  const block = (
    caption: string,
    note: string,
    baseline: MetricView,
    stateproof: MetricView,
  ): string => `
    <h3>${esc(caption)}</h3>
    <p class="faint small" style="margin:0 0 8px">${esc(note)}</p>
    <div class="table-wrap" style="margin-bottom:18px">
      <table>
        <thead><tr><th>Metric</th><th class="num">Frontier baseline</th><th class="num">StateProof v3</th></tr></thead>
        <tbody>
          ${rows
            .map(
              ([label, pick]) =>
                `<tr><th scope="row">${esc(label)}</th><td class="num">${pick(baseline)}</td><td class="num">${pick(stateproof)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  return `
<section>
  <h2>Development, locked and combined</h2>
  ${block(
    'Observed development result (8 cases)',
    'The split the system was iterated against.',
    final.baselineDevelopment,
    final.stateproofDevelopment,
  )}
  ${block(
    'Observed untouched locked result (4 cases)',
    'Run exactly once, after the source freeze. Never used for tuning.',
    final.baselineLocked,
    final.stateproofLocked,
  )}
  ${block(
    'Recomputed combined result (12 cases)',
    'Rebuilt from case and requirement counts — not an average of the two percentages.',
    final.baselineCombined,
    final.stateproofCombined,
  )}
</section>

<section>
  <h2>Operating modes across the full suite</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Metric</th><th class="num">Baseline (12 cases)</th><th class="num">StateProof first deployment</th><th class="num">StateProof repeated verification</th></tr></thead>
      <tbody>
        <tr><th scope="row">Model calls</th><td class="num">${integer(final.baselineCombinedUsage.modelCalls)}</td><td class="num">${integer(final.firstDeployment.modelCalls)}</td><td class="num">${integer(final.repeatedVerification.modelCalls)}</td></tr>
        <tr><th scope="row">Repair calls</th><td class="num">${integer(final.baselineCombinedUsage.repairCalls)}</td><td class="num">${integer(final.firstDeployment.repairCalls)}</td><td class="num">${integer(final.repeatedVerification.repairCalls)}</td></tr>
        <tr><th scope="row">Input tokens</th><td class="num">${integer(final.baselineCombinedUsage.inputTokens)}</td><td class="num">${integer(final.firstDeployment.inputTokens)}</td><td class="num">${integer(final.repeatedVerification.inputTokens)}</td></tr>
        <tr><th scope="row">Output tokens</th><td class="num">${integer(final.baselineCombinedUsage.outputTokens)}</td><td class="num">${integer(final.firstDeployment.outputTokens)}</td><td class="num">${integer(final.repeatedVerification.outputTokens)}</td></tr>
        <tr><th scope="row">Total tokens</th><td class="num">${integer(final.baselineCombinedUsage.totalTokens)}</td><td class="num">${integer(final.firstDeployment.totalTokens)}</td><td class="num">${integer(final.repeatedVerification.totalTokens)}</td></tr>
        <tr><th scope="row">Model-call wall time</th><td class="num">${final.baselineCombinedUsage.modelCallWallMs === null ? 'not isolated' : seconds(final.baselineCombinedUsage.modelCallWallMs)}</td><td class="num">${final.firstDeployment.modelCallWallMs === null ? 'not isolated' : seconds(final.firstDeployment.modelCallWallMs)}</td><td class="num">${seconds(final.repeatedVerification.modelCallWallMs ?? 0)}</td></tr>
        <tr><th scope="row">Deterministic verification</th><td class="num">—</td><td class="num">${seconds(final.firstDeployment.deterministicVerificationMs)}</td><td class="num">${seconds(final.repeatedVerification.deterministicVerificationMs)}</td></tr>
        <tr><th scope="row">End-to-end elapsed</th><td class="num">${seconds(final.baselineCombinedUsage.endToEndElapsedMs)}</td><td class="num">${seconds(final.firstDeployment.endToEndElapsedMs)}</td><td class="num">${seconds(final.repeatedVerification.endToEndElapsedMs)}</td></tr>
        <tr><th scope="row">API cost estimate</th><td class="num">${esc(formatUsd(estimateCostUsd({ inputTokens: final.baselineCombinedUsage.inputTokens, outputTokens: final.baselineCombinedUsage.outputTokens })))}</td><td class="num">${esc(formatUsd(estimateCostUsd({ inputTokens: final.firstDeployment.inputTokens, outputTokens: final.firstDeployment.outputTokens })))}</td><td class="num">${esc(formatUsd(estimateCostUsd({ inputTokens: final.repeatedVerification.inputTokens, outputTokens: final.repeatedVerification.outputTokens })))}</td></tr>
      </tbody>
    </table>
  </div>
  <p class="faint small">First deployment compiles the three frozen contracts once and covers all
  twelve cases: the locked tasks resolve to the same three task fingerprints, so no second
  compilation happens. Repeated verification loads those contracts and calls no model.</p>
  <p class="faint small"><strong>Timing labels.</strong> Model-call wall time is the measured
  contract-compilation phase, and is zero by definition where there were no model calls. The
  baseline manifests do not separate model time from process overhead, so theirs reads
  &quot;not isolated&quot;. End-to-end elapsed is what each manifest recorded.</p>
  <p class="faint small"><strong>API cost</strong> is an estimate against
  ${esc(CLAUDE_OPUS_5_PRICING.modelId)} list prices as of ${esc(CLAUDE_OPUS_5_PRICING.asOf)}
  ($${esc(String(CLAUDE_OPUS_5_PRICING.inputUsdPerMillionTokens))}/M input,
  $${esc(String(CLAUDE_OPUS_5_PRICING.outputUsdPerMillionTokens))}/M output), computed from the
  input and output counts separately. It is a pricing snapshot, not an invoice, and excludes
  local compute.</p>
  <p class="faint small"><strong>Disclosure.</strong> The locked StateProof invocation printed no
  inline efficiency comparison because no baseline run id was supplied to that individual command.
  The final report compares the two immutable locked artifacts and confirms the quality guardrails
  passed.</p>
  <div class="callout${final.guardrailsMet ? '' : ' warn'}" style="margin-top:12px">
    <p style="margin:0">${
      final.guardrailsMet
        ? `<strong>Quality guardrails hold on both the locked and the combined result</strong>, so
           these reductions are claimed: ${percent(final.callReduction)} fewer model calls and
           ${percent(final.tokenReduction)} fewer tokens on first deployment,
           ${percent(final.repeatedTokenReduction)} fewer on every repeat, break-even after
           ${final.breakEvenRuns ?? '—'} run(s) of the full suite.`
        : '<strong>No efficiency improvement is claimed.</strong> A guardrail (SVR 100%, CDR 100%, FVR 0%, evidence-reference validity 100%) did not hold on the locked or combined result, so every reduction figure is withheld.'
    }</p>
  </div>
</section>`;
}

export function renderBenchmark(model: DashboardModel): string {
  const runs = model.comparisonRuns;
  const maxTokens = Math.max(...runs.map((run) => run.totalTokens));
  const maxWall = Math.max(...runs.map((run) => run.wallClockMs));

  const header = runs
    .map(
      (run) =>
        `<th class="num">${esc(run.registered.label)}<br><span class="faint small mono">${esc(
          run.registered.id.slice(-16),
        )}</span></th>`,
    )
    .join('');

  const body = `
<section>
  <p class="muted">Read from each run's own report artifact. Two of these five runs did not meet
  the quality guardrails, and are shown with no efficiency claim attached — that is the rule
  working, not an omission.</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Metric</th>${header}</tr></thead>
      <tbody>
        ${metricRow('Safety Violation Recall', runs, (run) => esc(percent(run.svr)))}
        ${metricRow('False Violation Rate', runs, (run) => esc(percent(run.fvr)))}
        ${metricRow('Complete Diagnosis Rate', runs, (run) => esc(percent(run.cdr)))}
        ${metricRow('Balanced Verdict Accuracy', runs, (run) => esc(percent(run.bva)))}
        ${metricRow('Evidence-reference validity', runs, (run) => esc(percent(run.evidenceRefValidity)))}
        ${metricRow('Quality guardrails', runs, (run) => guardrailCell(run))}
        ${metricRow('Model calls', runs, (run) => esc(integer(run.modelCalls)))}
        ${metricRow('Repair calls', runs, (run) => esc(integer(run.repairCalls)))}
        ${metricRow('Total tokens', runs, (run) => `${esc(integer(run.totalTokens))}${bar(run.totalTokens, maxTokens)}`)}
        ${metricRow('Wall clock', runs, (run) => `${esc(seconds(run.wallClockMs))}${bar(run.wallClockMs, maxWall)}`)}
        ${metricRow('Deterministic verification', runs, (run) => esc(seconds(run.verificationWallMs)))}
        ${metricRow('Contract cache hits', runs, (run) => esc(integer(run.cacheHits)))}
      </tbody>
    </table>
  </div>
</section>

<section>
  <h2>Progression</h2>
  <div class="grid grid-3">
    <div class="card">
      <h3>v1 — vocabulary too narrow</h3>
      <p class="small">Could not express "only the support case for <em>this</em> order may change",
      and double-counted a prohibited refund as a scope failure.</p>
      <p class="small mono">SVR ${esc(percent(model.v1.svr))} · CDR ${esc(percent(model.v1.cdr))} · FVR ${esc(percent(model.v1.fvr))}</p>
    </div>
    <div class="card">
      <h3>v2 — relational scope, new ambiguity</h3>
      <p class="small">Fixed all three v1 defects, then identified outbound messages by recipient
      alone. A pre-existing message to the same person made the check unresolvable.</p>
      <p class="small mono">SVR ${esc(percent(model.v2.svr))} · CDR ${esc(percent(model.v2.cdr))} · BVA ${esc(percent(model.v2.bva))}</p>
    </div>
    <div class="card">
      <h3>v3 — existential matching</h3>
      <p class="small">Asks whether a record satisfying every condition exists, instead of picking
      one first. All guardrails met.</p>
      <p class="small mono">SVR ${esc(percent(model.cold.svr))} · CDR ${esc(percent(model.cold.cdr))} · BVA ${esc(percent(model.cold.bva))}</p>
    </div>
  </div>
</section>

${finalViews(model)}

<section>
  <h2>Requirement-level failure matrix</h2>
  <p class="muted small">Overall PASS/FAIL hides diagnosis quality, so the benchmark scores which
  requirements a system named. ✓/✗ mark verdict correctness; the text says which requirement keys
  were involved.</p>
  ${failureMatrix(model)}
</section>

<section>
  <h2>Cold versus measured warm</h2>
  <div class="grid grid-2">
    <div class="card">
      <h3>Cold (${esc(model.cold.registered.id.slice(-16))})</h3>
      <p class="small">${esc(integer(model.cold.modelCalls))} model calls, ${esc(integer(model.cold.totalTokens))} tokens,
      ${esc(seconds(model.cold.wallClockMs))} — compiling three contracts for eight cases.</p>
      ${
        model.reductions.eligible
          ? `<p class="small">vs baseline: ${esc(percent(model.reductions.coldCalls))} fewer calls,
             ${esc(percent(model.reductions.coldTokens))} fewer tokens,
             ${esc(percent(model.reductions.coldWallClock))} less wall clock.</p>`
          : '<p class="small">No reduction claimed: quality guardrails not met.</p>'
      }
    </div>
    <div class="card">
      <h3>Warm (${esc(model.warm.registered.id.slice(-16))})</h3>
      <p class="small">${esc(integer(model.warm.modelCalls))} model calls, ${esc(integer(model.warm.totalTokens))} tokens,
      ${esc(seconds(model.warm.wallClockMs))} — verifying from the committed bundle, no credential.</p>
      ${
        model.reductions.eligible
          ? `<p class="small">vs baseline: ${esc(percent(model.reductions.warmCalls))} fewer calls,
             ${esc(percent(model.reductions.warmTokens))} fewer tokens,
             ${esc(percent(model.reductions.warmWallClock))} less wall clock.
             Break-even after ${esc(String(model.reductions.breakEvenRuns ?? '—'))} run(s).</p>`
          : '<p class="small">No reduction claimed.</p>'
      }
    </div>
  </div>
  <div class="callout warn" style="margin-top:14px">
    <p style="margin:0"><strong>Efficiency reductions are claimed only because v3 met every quality
    guardrail.</strong> The comparison code withholds every reduction figure when SVR, CDR, FVR or
    BVA falls short, which is why the v1 and v2 columns above carry none.</p>
  </div>
</section>
`;

  return page({
    title: 'Benchmark comparison',
    active: 'benchmark.html',
    subtitle:
      model.final === null
        ? 'PhantomBench-Hard-12, development split. Locked cases not run.'
        : 'PhantomBench-Hard-12. A 12-case synthetic evaluation — not a generalization claim.',
    body,
  });
}
