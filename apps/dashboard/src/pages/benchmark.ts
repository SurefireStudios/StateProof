import type { LoadedRun } from '@stateproof/submission';
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
    subtitle: 'PhantomBench-Hard-12, development split. Locked cases not run.',
    body,
  });
}
