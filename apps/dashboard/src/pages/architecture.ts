import type { DashboardModel } from '../model';
import { esc, integer, page, seconds } from '../shell';

/**
 * The architecture diagram is inline SVG generated here, not an image asset.
 *
 * It has to show one thing above all: where the gold-isolation boundary sits,
 * and that the Contract Agent is on the wrong side of it to cheat.
 */

function diagram(): string {
  return `
<svg viewBox="0 0 900 430" role="img" aria-label="StateProof architecture: cold path compiles a contract once, warm path verifies from the persisted bundle, gold data is only reachable by the scorer."
     class="diagram">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#4da3ff"/>
    </marker>
    <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7686"/>
    </marker>
  </defs>

  <g font-family="ui-monospace, monospace" font-size="12">
    <!-- agent-visible inputs -->
    <rect x="20" y="30" width="180" height="120" rx="8" fill="#12151a" stroke="#2c333d"/>
    <text x="34" y="52" fill="#98a3b3" font-size="11">AGENT-VISIBLE INPUTS</text>
    <text x="34" y="74" fill="#e7ecf3">task instruction</text>
    <text x="34" y="92" fill="#e7ecf3">tool registry</text>
    <text x="34" y="110" fill="#e7ecf3">domain schema</text>
    <text x="34" y="134" fill="#6b7686" font-size="11">no run data at all</text>

    <!-- contract agent -->
    <rect x="250" y="30" width="200" height="120" rx="8" fill="#12151a" stroke="#4da3ff"/>
    <text x="264" y="52" fill="#4da3ff" font-size="11">CONTRACT AGENT (model)</text>
    <text x="264" y="76" fill="#e7ecf3">compile requirements</text>
    <text x="264" y="94" fill="#e7ecf3">+ typed assertions</text>
    <text x="264" y="118" fill="#98a3b3" font-size="11">semantic lint + 1 repair</text>
    <text x="264" y="136" fill="#6b7686" font-size="11">runs once per task</text>

    <!-- bundle -->
    <rect x="500" y="30" width="180" height="120" rx="8" fill="#12151a" stroke="#2c333d"/>
    <text x="514" y="52" fill="#98a3b3" font-size="11">CONTRACT BUNDLE</text>
    <text x="514" y="74" fill="#e7ecf3">fingerprint → contract</text>
    <text x="514" y="92" fill="#e7ecf3">hashes + provenance</text>
    <text x="514" y="116" fill="#6b7686" font-size="11">committed to the repo</text>

    <!-- run under test -->
    <rect x="20" y="220" width="180" height="120" rx="8" fill="#12151a" stroke="#2c333d"/>
    <text x="34" y="242" fill="#98a3b3" font-size="11">RUN UNDER TEST</text>
    <text x="34" y="264" fill="#e7ecf3">trajectory</text>
    <text x="34" y="282" fill="#e7ecf3">initial + final state</text>
    <text x="34" y="300" fill="#e7ecf3">final response</text>
    <text x="34" y="324" fill="#f0b429" font-size="11">a claim, not evidence</text>

    <!-- verifier -->
    <rect x="250" y="220" width="200" height="120" rx="8" fill="#12151a" stroke="#35c98b"/>
    <text x="264" y="242" fill="#35c98b" font-size="11">DETERMINISTIC VERIFIER</text>
    <text x="264" y="266" fill="#e7ecf3">evaluate assertions</text>
    <text x="264" y="284" fill="#e7ecf3">build evidence refs</text>
    <text x="264" y="308" fill="#6b7686" font-size="11">zero model calls</text>

    <!-- predictions -->
    <rect x="500" y="220" width="180" height="120" rx="8" fill="#12151a" stroke="#2c333d"/>
    <text x="514" y="242" fill="#98a3b3" font-size="11">PREDICTIONS</text>
    <text x="514" y="264" fill="#e7ecf3">verdict per case</text>
    <text x="514" y="282" fill="#e7ecf3">per-requirement status</text>
    <text x="514" y="300" fill="#e7ecf3">evidence references</text>

    <!-- scorer / gold -->
    <rect x="730" y="220" width="150" height="120" rx="8" fill="#12151a" stroke="#f0b429" stroke-dasharray="4 3"/>
    <text x="744" y="242" fill="#f0b429" font-size="11">SCORER</text>
    <text x="744" y="264" fill="#e7ecf3">gold contract</text>
    <text x="744" y="282" fill="#e7ecf3">gold verdict</text>
    <text x="744" y="306" fill="#6b7686" font-size="11">opened only after</text>
    <text x="744" y="322" fill="#6b7686" font-size="11">predictions exist</text>

    <!-- flows -->
    <line x1="200" y1="90" x2="248" y2="90" stroke="#4da3ff" stroke-width="1.5" marker-end="url(#arrow)"/>
    <line x1="450" y1="90" x2="498" y2="90" stroke="#4da3ff" stroke-width="1.5" marker-end="url(#arrow)"/>
    <path d="M 590 150 L 590 190 L 350 190 L 350 218" fill="none" stroke="#4da3ff" stroke-width="1.5" marker-end="url(#arrow)"/>
    <line x1="200" y1="280" x2="248" y2="280" stroke="#6b7686" stroke-width="1.5" marker-end="url(#arrow-dim)"/>
    <line x1="450" y1="280" x2="498" y2="280" stroke="#35c98b" stroke-width="1.5" marker-end="url(#arrow)"/>
    <line x1="680" y1="280" x2="728" y2="280" stroke="#f0b429" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrow-dim)"/>

    <text x="596" y="182" fill="#4da3ff" font-size="11">warm path: load, verify, no model</text>
    <text x="256" y="205" fill="#98a3b3" font-size="11">cold path: compile once, then verify</text>

    <!-- gold boundary -->
    <line x1="705" y1="16" x2="705" y2="400" stroke="#f0b429" stroke-width="1" stroke-dasharray="6 5"/>
    <text x="712" y="404" fill="#f0b429" font-size="11">gold-isolation boundary</text>
  </g>
</svg>`;
}

export function renderArchitecture(model: DashboardModel): string {
  const bundle = model.view.bundles[0];

  const body = `
<section>
  ${diagram()}
</section>

<section class="grid grid-2">
  <div class="card">
    <h3>Cold path</h3>
    <p class="small">One model call per unique task. The Contract Agent sees the task, the tools and
    the domain schema — never a trajectory, a state snapshot, a final response, a case id or a gold
    file. The compiled contract is validated, semantically linted, hashed and written to a bundle.</p>
    <p class="small mono">${esc(integer(model.cold.modelCalls))} calls · ${esc(integer(model.cold.totalTokens))} tokens · ${esc(seconds(model.cold.wallClockMs))}</p>
  </div>
  <div class="card">
    <h3>Warm path</h3>
    <p class="small">The bundle is loaded, every hash re-derived, and each case's task fingerprint
    recomputed from the task in front of it. A mismatch fails closed rather than recompiling —
    silently filling a gap would turn a measured warm run into a partly cold one.</p>
    <p class="small mono">${esc(integer(model.warm.modelCalls))} calls · ${esc(integer(model.warm.totalTokens))} tokens · ${esc(seconds(model.warm.wallClockMs))}</p>
  </div>
</section>

<section>
  <h2>Gold isolation</h2>
  <p class="muted">Gold contracts and gold verdicts live behind a package boundary
  (<code>@stateproof/benchmark/gold</code>). The prediction phase imports only the agent-facing
  surface, so it cannot reach them, and predictions are written to disk before the scorer opens its
  first gold file. A test observes every case-file read and asserts that ordering directly.</p>
</section>

<section id="reproduce">
  <h2>Reproduce this</h2>
  <p class="muted">No API credential is required. The replay loads the committed contract bundle,
  re-verifies the eight development cases and compares canonical predictions to the pinned warm
  run.</p>
  <pre>pnpm install
pnpm reproduce</pre>
  <p class="small muted">Expect, at a high level:</p>
  <ul class="small muted">
    <li>Core-12 and Hard-12 fixtures validate</li>
    <li>the pinned registry and every artifact hash verify</li>
    <li>zero model calls, zero tokens, no raw response files written</li>
    <li>predictions byte-identical to <span class="mono">${esc(model.warm.registered.id)}</span></li>
    <li>SVR / FVR / CDR / BVA identical to the pinned report</li>
    <li><span class="mono">RESULT: PASSED</span></li>
  </ul>
  <p class="small muted">Other commands: <code>pnpm reproduce:check</code> (artifacts and provenance
  only), <code>pnpm dashboard:build</code>, <code>pnpm dev</code>,
  <code>pnpm check:provenance &lt;runId&gt;</code>.</p>
  <dl class="kv card">
    <dt>Pinned registry</dt><dd><a href="../../submission/reproduction-manifest.json">submission/reproduction-manifest.json</a></dd>
    <dt>Contract bundle</dt><dd>${esc(bundle?.registered.contractRunId ?? '—')}</dd>
    <dt>Assertion schema</dt><dd>${esc(bundle?.registered.assertionSchemaVersion ?? '—')}</dd>
    <dt>Source commit</dt><dd>${esc(model.cold.manifest.gitCommitSha ?? '—')}</dd>
    <dt>Judge summary</dt><dd><a href="../../artifacts/submission/development-summary.md">artifacts/submission/development-summary.md</a></dd>
  </dl>
</section>

<section id="limitations">
  <h2>Limitations</h2>
  <ul class="muted">
    <li>Validation is demonstrated in a <strong>synthetic refund-operations domain</strong>. Nothing
    here establishes behaviour on real production systems.</li>
    <li>The semantic lint's task-fact extraction is <strong>template-oriented and regex-based</strong>.
    A broader domain needs typed task adapters rather than pattern matching.</li>
    <li><strong>Development-split results only.</strong> The four locked challenge cases have not
    been run, by design, so nothing is tuned against them.</li>
    <li><strong>No USD cost is claimed.</strong> Token counts are measured; no pricing rule is
    implemented.</li>
    <li>Two historical provenance defects are preserved and documented rather than repaired: the
    Gate 3A run predates its own commit, and the Gate 3C cold manifest carries a stale
    <code>stage</code> label. Both are cosmetic-to-the-result and both are visible in the artifacts.</li>
    <li>This is not a claim of production readiness.</li>
  </ul>
</section>
`;

  return page({
    title: 'Architecture & reproduction',
    active: 'architecture.html',
    subtitle: 'Compile once, cache, verify deterministically — and prove it offline.',
    body,
  });
}
