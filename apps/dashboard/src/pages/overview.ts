import type { DashboardModel } from '../model';
import { INSIGHT, PITCH, esc, integer, page, percent, seconds } from '../shell';

/**
 * The overview answers, in order: who has the problem, why it is hard to catch,
 * what StateProof does about it, and what that measured.
 */
export function renderOverview(model: DashboardModel): string {
  const { baseline, cold, warm, reductions } = model;

  const body = `
<section class="grid grid-2">
  <div>
    <p class="lede">${esc(INSIGHT)}</p>
    <p class="muted">An agent that books a refund, emails a customer and closes a ticket
    produces one artefact you can read instantly — its own summary — and several you cannot.
    StateProof reads the ones you cannot.</p>
    <p><a class="btn" href="inspector.html">Inspect ${esc(model.defaultCaseId)}</a>
       <a class="btn ghost" href="architecture.html#reproduce">Reproduce locally</a></p>
  </div>
  <div class="card">
    <h3>Who this is for</h3>
    <p class="small">AI product, evaluation and operations engineers deploying agents that
    <strong>modify business systems</strong> — refunds, tickets, CRM records, inventory.</p>
    <h3 style="margin-top:14px">The bottleneck</h3>
    <p class="small">A confident final response and a clean tool log can both be true while the
    work is wrong. Six failure shapes hide behind them:</p>
    <ul class="small muted" style="margin:6px 0 0 18px; padding:0">
      <li>no-op or phantom completion</li>
      <li>partial completion</li>
      <li>wrong-target action</li>
      <li>wrong amount, recipient or status</li>
      <li>approval recorded <em>after</em> the protected action</li>
      <li>unrelated side effects</li>
    </ul>
  </div>
</section>

<section>
  <h2>How StateProof works</h2>
  <ol class="steps">
    <li><strong>Compile the contract once.</strong> A Contract Agent turns the task into typed,
    machine-checkable requirements — before it has seen the trajectory, the state, or the agent's
    answer. A contract written after the run is a rationalisation, not a contract.</li>
    <li><strong>Cache it by task fingerprint.</strong> The key covers the task text, tools, domain
    schema, assertion vocabulary, prompt and model configuration. Same task, no model call.</li>
    <li><strong>Verify deterministically.</strong> Code evaluates the contract against the
    trajectory and both state snapshots. No model is in the loop, so the same inputs always
    produce the same verdict.</li>
    <li><strong>Cite evidence that exists.</strong> Every reference is generated from the records
    and events the assertions actually matched, so a citation cannot point at nothing.</li>
  </ol>
</section>

<section>
  <h2>Measured on the hard development split</h2>
  <p class="muted small">Development split of PhantomBench-Hard-12, eight cases.
  Every figure below comes from <code>${esc(cold.registered.reportJsonPath)}</code>,
  <code>${esc(warm.registered.reportJsonPath)}</code> and
  <code>${esc(baseline.registered.manifestPath)}</code>.</p>
  <div class="grid grid-4">
    <div class="card">
      <h3>Quality parity</h3>
      <p class="stat">${esc(percent(cold.svr))}</p>
      <p class="stat-note">Safety Violation Recall, matching the frontier baseline.
      FVR ${esc(percent(cold.fvr))}, CDR ${esc(percent(cold.cdr))}, BVA ${esc(percent(cold.bva))}.</p>
    </div>
    <div class="card">
      <h3>Cold model calls</h3>
      <p class="stat">${esc(integer(cold.modelCalls))} <span class="faint" style="font-size:16px">of ${esc(integer(baseline.modelCalls))}</span></p>
      <p class="stat-note">${reductions.eligible ? `${esc(percent(reductions.coldCalls))} fewer than the baseline` : 'no reduction claimed'};
      ${esc(integer(cold.totalTokens))} tokens vs ${esc(integer(baseline.totalTokens))}.</p>
    </div>
    <div class="card">
      <h3>Warm model calls</h3>
      <p class="stat">${esc(integer(warm.modelCalls))}</p>
      <p class="stat-note">Measured, not assumed: ${esc(integer(warm.totalTokens))} tokens across
      ${esc(integer(model.cases.length))} cases, verifying from the committed contract bundle.</p>
    </div>
    <div class="card">
      <h3>Warm runtime</h3>
      <p class="stat">${esc(seconds(warm.wallClockMs))}</p>
      <p class="stat-note">Whole suite, of which ${esc(seconds(warm.verificationWallMs))} is
      deterministic verification. Baseline: ${esc(seconds(baseline.wallClockMs))}.</p>
    </div>
  </div>
</section>

<section>
  <div class="callout">
    <p style="margin:0"><strong>Efficiency is only claimed after quality is met.</strong>
    Two earlier iterations were cheaper than the baseline and are reported with
    <em>no</em> reduction figures, because they missed a violation or withheld a verdict.
    Being cheaper while missing a violation is a cheaper way to be wrong.
    See <a href="benchmark.html">Benchmark</a> and <a href="changelog.html">Changelog</a>.</p>
  </div>
</section>

<section>
  <h2>What it costs to keep verifying</h2>
  <div class="grid grid-2">
    <div class="card">
      <h3>Break-even</h3>
      <p class="stat">${reductions.breakEvenRuns === null ? '—' : esc(String(reductions.breakEvenRuns))} run${reductions.breakEvenRuns === 1 ? '' : 's'}</p>
      <p class="stat-note">Compiling once is already cheaper than one frontier pass over the same
      suite; every repeat after that is free of model cost.</p>
    </div>
    <div class="card">
      <h3>Deterministic repeats</h3>
      <p class="stat">${esc(String(1 + model.warmRepeats.length))}× identical</p>
      <p class="stat-note">Warm runs produced byte-identical canonical predictions
      (sha256 <span class="mono">${esc(warm.canonicalPredictionSha256.slice(0, 16))}</span>),
      identical contract hashes and identical metrics.</p>
    </div>
  </div>
</section>

<section>
  <h2>Scope, stated plainly</h2>
  <p class="muted">These are <strong>development-split</strong> results in a synthetic
  refund-operations domain. The four locked challenge cases have deliberately not been run, so
  nothing here is tuned against them. Cost in USD is not claimed, because no pricing rule is
  implemented. See <a href="architecture.html#limitations">limitations</a>.</p>
</section>
`;

  return page({
    title: 'Overview',
    active: 'index.html',
    subtitle: PITCH,
    body,
  });
}
