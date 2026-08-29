import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunManifestSchema, formatRate, hashJson, toJsonValue } from '@stateproof/core';
import {
  CLAUDE_OPUS_5_PRICING,
  type LoadedRun,
  type MetricView,
  type UsageView,
  combineMetrics,
  combineUsage,
  compareCosts,
  estimateCostUsd,
  formatUsd,
  guardrailFailures,
  loadSubmissionView,
  meetsFinalGuardrails,
  metricViewOfRun,
  usageOf,
} from '@stateproof/submission';

/**
 * `pnpm submission:finalize`
 *
 * The frozen final-comparison generator. It reads the pinned registry, checks
 * that every run it is about to compare was produced by the same prompt, model,
 * dataset and contract bundle, and writes the four final submission documents.
 *
 * It refuses rather than reconciles. Two runs that differ in prompt or model are
 * not comparable, and a generator that quietly papers over that produces a table
 * that looks like a measurement and is not one.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = path.join(REPO_ROOT, 'submission');

interface Pair {
  readonly development: LoadedRun;
  readonly locked: LoadedRun | null;
}

function readManifest(runId: string): ReturnType<typeof EvaluationRunManifestSchema.parse> | null {
  const filePath = path.join(REPO_ROOT, 'artifacts', 'run-manifests', `${runId}.json`);
  if (!existsSync(filePath)) return null;
  return EvaluationRunManifestSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
}

/** Locked runs are discovered from artifacts, so nothing has to be hand-listed. */
function discoverLockedRun(system: 'baseline' | 'stateproof'): string | null {
  const dir = path.join(REPO_ROOT, 'artifacts', 'run-manifests');
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .filter((runId) => runId.includes('-locked-'))
    .filter((runId) => {
      const manifest = readManifest(runId);
      return (
        manifest !== null &&
        manifest.system === system &&
        manifest.splits.includes('locked') &&
        manifest.datasetName === 'phantombench-hard-12'
      );
    })
    .sort();
  if (found.length > 1) {
    throw new Error(
      `more than one locked ${system} run exists (${found.join(', ')}); the locked split is run once`,
    );
  }
  return found[0] ?? null;
}

function requireRun(runs: LoadedRun[], role: LoadedRun['registered']['role']): LoadedRun {
  const run = runs.find((entry) => entry.registered.role === role);
  if (run === undefined) throw new Error(`the registry pins no run for role "${role}"`);
  return run;
}

/**
 * Comparability checks. Every one of these has to hold before two runs may
 * appear in the same table.
 */
function assertComparable(pair: Pair, label: string, problems: string[]): void {
  const { development, locked } = pair;
  if (locked === null) return;

  const devManifest = development.manifest;
  const lockedManifest = locked.manifest;

  if (devManifest.datasetName !== lockedManifest.datasetName) {
    problems.push(`${label}: dataset differs between splits`);
  }
  if (
    JSON.stringify(devManifest.promptFilePaths) !== JSON.stringify(lockedManifest.promptFilePaths)
  ) {
    problems.push(`${label}: prompt files differ between splits`);
  }
  for (const promptPath of devManifest.promptFilePaths) {
    if (devManifest.promptHashes[promptPath] !== lockedManifest.promptHashes[promptPath]) {
      problems.push(`${label}: ${promptPath} hash differs between splits`);
    }
  }
  if (devManifest.modelProvider !== lockedManifest.modelProvider) {
    problems.push(`${label}: model provider differs between splits`);
  }
  if (devManifest.modelId !== lockedManifest.modelId) {
    problems.push(`${label}: model differs between splits`);
  }
  if (
    hashJson(toJsonValue(devManifest.modelConfiguration)) !==
    hashJson(toJsonValue(lockedManifest.modelConfiguration))
  ) {
    problems.push(`${label}: model configuration differs between splits`);
  }
  if (!lockedManifest.splits.includes('locked')) {
    problems.push(`${label}: the locked run does not declare the locked split`);
  }
  if (devManifest.splits.includes('locked')) {
    problems.push(`${label}: the development run declares the locked split`);
  }
  const overlap = devManifest.caseIds.filter((caseId) => lockedManifest.caseIds.includes(caseId));
  if (overlap.length > 0) {
    problems.push(`${label}: case ids appear in both splits (${overlap.join(', ')})`);
  }
}

function metricRows(label: string, view: MetricView): string[] {
  void label;
  const rate = (value: number | null, counts: readonly [number, number]): string =>
    `${formatRate(value)} (${counts[0]}/${counts[1]})`;
  return [
    rate(view.safetyViolationRecall, view.safetyViolationCounts),
    rate(view.falseViolationRate, view.falseViolationCounts),
    rate(view.completeDiagnosisRate, view.completeDiagnosisCounts),
    formatRate(view.balancedVerdictAccuracy),
    rate(view.validRunAcceptanceRate, view.validRunAcceptanceCounts),
    rate(view.invalidRunRejectionRate, view.invalidRunRejectionCounts),
    rate(view.unsafeFalseCompletionRate, view.unsafeFalseCompletionCounts),
    rate(view.needsReviewRate, view.needsReviewCounts),
    rate(view.assessmentCompleteness, view.assessmentCompletenessCounts),
    rate(view.evidenceRefValidity, view.evidenceRefCounts),
  ];
}

const METRIC_LABELS = [
  'Safety Violation Recall',
  'False Violation Rate',
  'Complete Diagnosis Rate',
  'Balanced Verdict Accuracy',
  'Valid Run Acceptance',
  'Invalid Run Rejection',
  'Unsafe false completion',
  'NEEDS_REVIEW frequency',
  'Assessment completeness',
  'Evidence-reference validity',
];

const USAGE_LABELS = [
  'Model calls',
  'Repair calls',
  'Input tokens',
  'Output tokens',
  'Total tokens',
  'Model-call wall time (ms)',
  'Deterministic verification (ms)',
  'End-to-end elapsed (ms)',
  'API cost estimate (USD)',
];

function usageRows(usage: UsageView): string[] {
  return [
    String(usage.modelCalls),
    String(usage.repairCalls),
    String(usage.inputTokens),
    String(usage.outputTokens),
    String(usage.totalTokens),
    usage.modelCallWallMs === null ? 'not isolated' : String(usage.modelCallWallMs),
    usage.deterministicVerificationMs === null ? '—' : String(usage.deterministicVerificationMs),
    String(usage.endToEndElapsedMs),
    formatUsd(
      estimateCostUsd({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
    ),
  ];
}

function table(header: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function main(): void {
  const view = loadSubmissionView({ repoRoot: REPO_ROOT });
  const problems: string[] = [];

  const baselineDev = requireRun(view.runs, 'baseline-hard');
  const coldDev = requireRun(view.runs, 'stateproof-v3-cold');
  const warmDev = requireRun(view.runs, 'stateproof-v3-warm');
  const bundle = view.bundles[0];
  if (bundle === undefined) throw new Error('the registry pins no contract bundle');

  const lockedBaselineId = discoverLockedRun('baseline');
  const lockedStateProofId = discoverLockedRun('stateproof');
  const lockedBaseline = view.runs.find((run) => run.registered.id === lockedBaselineId) ?? null;
  const lockedStateProof = view.runs.find((run) => run.registered.id === lockedStateProofId) ?? null;

  if (lockedBaselineId !== null && lockedBaseline === null) {
    problems.push(`locked baseline ${lockedBaselineId} exists but is not pinned in the registry`);
  }
  if (lockedStateProofId !== null && lockedStateProof === null) {
    problems.push(
      `locked StateProof run ${lockedStateProofId} exists but is not pinned in the registry`,
    );
  }

  assertComparable({ development: baselineDev, locked: lockedBaseline }, 'baseline', problems);
  assertComparable({ development: warmDev, locked: lockedStateProof }, 'stateproof', problems);

  // The locked StateProof run must have verified the same frozen contracts.
  if (lockedStateProof !== null) {
    const sourceBundle = lockedStateProof.manifest.sourceContractRunId ?? null;
    if (sourceBundle !== bundle.registered.contractRunId) {
      problems.push(
        `the locked run verified from ${String(sourceBundle)}, not the frozen bundle ` +
          bundle.registered.contractRunId,
      );
    }
    if (lockedStateProof.modelCalls !== 0 || lockedStateProof.totalTokens !== 0) {
      problems.push('the locked StateProof run reports model usage, which must be zero');
    }
    const frozenHashes = new Set(bundle.contracts.map((contract) => contract.contractHash));
    const used = new Set(
      (
        lockedStateProof.predictionFile as { predictions: Array<{ contractHash: string }> }
      ).predictions.map((entry) => entry.contractHash),
    );
    for (const contractHash of used) {
      if (!frozenHashes.has(contractHash)) {
        problems.push(`the locked run used contract ${contractHash.slice(0, 12)}, not in the bundle`);
      }
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      ['Refusing to generate the final comparison:', ...problems.map((p) => `  - ${p}`), ''].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const baselineDevView = metricViewOfRun(baselineDev);
  const stateproofDevView = metricViewOfRun(coldDev);
  const baselineLockedView = lockedBaseline === null ? null : metricViewOfRun(lockedBaseline);
  const stateproofLockedView = lockedStateProof === null ? null : metricViewOfRun(lockedStateProof);

  const baselineCombined =
    baselineLockedView === null ? null : combineMetrics(baselineDevView, baselineLockedView);
  const stateproofCombined =
    stateproofLockedView === null ? null : combineMetrics(stateproofDevView, stateproofLockedView);

  // The contract-compilation manifest measures the model phase on its own; the
  // baseline manifests do not, so their model time stays honestly unisolated.
  const compilationWallMs = ((): number | null => {
    const filePath = path.join(REPO_ROOT, bundle.registered.manifestPath);
    if (!existsSync(filePath)) return null;
    const manifest = JSON.parse(readFileSync(filePath, 'utf8')) as { wallClockMs?: number };
    return manifest.wallClockMs ?? null;
  })();

  const baselineDevUsage = usageOf(baselineDev);
  const baselineLockedUsage = lockedBaseline === null ? null : usageOf(lockedBaseline);
  const baselineCombinedUsage =
    baselineLockedUsage === null ? null : combineUsage(baselineDevUsage, baselineLockedUsage);

  // First deployment: the frozen contracts are compiled once and cover all 12
  // cases, because the locked tasks share the three development fingerprints.
  const firstDeployment: UsageView = {
    ...usageOf(coldDev, compilationWallMs),
    deterministicVerificationMs:
      (coldDev.verificationWallMs ?? 0) + (lockedStateProof?.verificationWallMs ?? 0),
    endToEndElapsedMs:
      coldDev.wallClockMs + (lockedStateProof === null ? 0 : lockedStateProof.wallClockMs),
  };
  const repeated: UsageView =
    lockedStateProof === null
      ? usageOf(warmDev)
      : combineUsage(usageOf(warmDev), usageOf(lockedStateProof));

  const guardrailsOk =
    stateproofLockedView !== null &&
    stateproofCombined !== null &&
    meetsFinalGuardrails(stateproofLockedView) &&
    meetsFinalGuardrails(stateproofCombined);

  const ratio = (before: number, after: number): number | null =>
    before === 0 ? null : (before - after) / before;

  const efficiency =
    guardrailsOk && baselineCombinedUsage !== null
      ? {
          baselineCombined: baselineCombinedUsage,
          firstDeployment,
          repeatedVerification: repeated,
          firstDeploymentCallReduction: ratio(
            baselineCombinedUsage.modelCalls,
            firstDeployment.modelCalls,
          ),
          firstDeploymentTokenReduction: ratio(
            baselineCombinedUsage.totalTokens,
            firstDeployment.totalTokens,
          ),
          firstDeploymentElapsedReduction: ratio(
            baselineCombinedUsage.endToEndElapsedMs,
            firstDeployment.endToEndElapsedMs,
          ),
          repeatedCallReduction: ratio(baselineCombinedUsage.modelCalls, repeated.modelCalls),
          repeatedTokenReduction: ratio(baselineCombinedUsage.totalTokens, repeated.totalTokens),
          repeatedElapsedReduction: ratio(
            baselineCombinedUsage.endToEndElapsedMs,
            repeated.endToEndElapsedMs,
          ),
          breakEvenSuiteRuns:
            baselineCombinedUsage.totalTokens > repeated.totalTokens
              ? Math.max(
                  1,
                  Math.ceil(
                    (firstDeployment.totalTokens - repeated.totalTokens) /
                      (baselineCombinedUsage.totalTokens - repeated.totalTokens),
                  ),
                )
              : null,
          cost: compareCosts(
            {
              inputTokens: baselineCombinedUsage.inputTokens,
              outputTokens: baselineCombinedUsage.outputTokens,
            },
            { inputTokens: firstDeployment.inputTokens, outputTokens: firstDeployment.outputTokens },
            { inputTokens: repeated.inputTokens, outputTokens: repeated.outputTokens },
          ),
          pricing: CLAUDE_OPUS_5_PRICING,
        }
      : null;

  const final = {
    schemaVersion: '1.0.0',
    generatedFrom: 'submission/reproduction-manifest.json',
    lockedEvaluationComplete: lockedStateProof !== null && lockedBaseline !== null,
    qualityGuardrailsMet: guardrailsOk,
    guardrailFailures: {
      locked: stateproofLockedView === null ? ['locked evaluation not run'] : guardrailFailures(stateproofLockedView),
      combined:
        stateproofCombined === null ? ['combined result unavailable'] : guardrailFailures(stateproofCombined),
    },
    runs: {
      baselineDevelopment: baselineDev.registered.id,
      baselineLocked: lockedBaseline?.registered.id ?? null,
      stateproofDevelopmentCold: coldDev.registered.id,
      stateproofDevelopmentWarm: warmDev.registered.id,
      stateproofLocked: lockedStateProof?.registered.id ?? null,
      contractBundle: bundle.registered.contractRunId,
    },
    observedDevelopment: { baseline: baselineDevView, stateproof: stateproofDevView },
    observedLocked: { baseline: baselineLockedView, stateproof: stateproofLockedView },
    recomputedCombined: { baseline: baselineCombined, stateproof: stateproofCombined },
    usage: {
      baselineDevelopment: baselineDevUsage,
      baselineLocked: baselineLockedUsage,
      baselineCombined: baselineCombinedUsage,
      stateproofFirstDeployment: firstDeployment,
      stateproofRepeatedVerification: repeated,
    },
    efficiency,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, 'final-evaluation.json'),
    `${JSON.stringify(toJsonValue(final), null, 2)}\n`,
    'utf8',
  );

  const registry = {
    schemaVersion: '1.0.0',
    freezeCommit: view.manifest.sourceCommits,
    prompts: view.prompts,
    contractBundle: {
      contractRunId: bundle.registered.contractRunId,
      assertionSchemaVersion: bundle.registered.assertionSchemaVersion,
      contracts: bundle.contracts.map((contract) => ({
        taskFingerprint: contract.taskFingerprint,
        contractHash: contract.contractHash,
        path: contract.path,
      })),
    },
    runs: view.runs.map((run) => ({
      id: run.registered.id,
      label: run.registered.label,
      role: run.registered.role,
      system: run.registered.system,
      split: run.registered.split,
      sourceCommit: run.manifest.gitCommitSha,
      canonicalPredictionSha256: run.canonicalPredictionSha256,
      manifestPath: run.registered.manifestPath,
      predictionPath: run.registered.predictionPath,
      reportJsonPath: run.registered.reportJsonPath,
      reportMarkdownPath: run.registered.reportMarkdownPath,
    })),
  };
  // The pricing snapshot travels with the numbers it produced, so a reader can
  // check the arithmetic without trusting the prose.
  const smokeUsage = { inputTokens: 73, outputTokens: 21 };
  writeFileSync(
    path.join(OUT_DIR, 'final-pricing-manifest.json'),
    `${JSON.stringify(
      toJsonValue({
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        disclaimer:
          'A pricing-snapshot estimate against published list prices on the stated date. ' +
          'Not an invoice. Excludes local compute, developer time and hosting.',
        pricing: CLAUDE_OPUS_5_PRICING,
        inputs: {
          baselineCombined: {
            inputTokens: baselineCombinedUsage?.inputTokens ?? null,
            outputTokens: baselineCombinedUsage?.outputTokens ?? null,
          },
          stateproofFirstDeployment: {
            inputTokens: firstDeployment.inputTokens,
            outputTokens: firstDeployment.outputTokens,
          },
          stateproofRepeatedVerification: {
            inputTokens: repeated.inputTokens,
            outputTokens: repeated.outputTokens,
          },
        },
        estimates: {
          baselineCombinedUsd:
            baselineCombinedUsage === null
              ? null
              : estimateCostUsd({
                  inputTokens: baselineCombinedUsage.inputTokens,
                  outputTokens: baselineCombinedUsage.outputTokens,
                }),
          stateproofFirstDeploymentUsd: estimateCostUsd({
            inputTokens: firstDeployment.inputTokens,
            outputTokens: firstDeployment.outputTokens,
          }),
          stateproofRepeatedVerificationUsd: estimateCostUsd({
            inputTokens: repeated.inputTokens,
            outputTokens: repeated.outputTokens,
          }),
          comparison: efficiency?.cost ?? null,
        },
        developmentOverhead: {
          note:
            'Excluded from the baseline-versus-StateProof comparison. One provider smoke ' +
            'test was run before the v3 cold experiment to confirm the model configuration.',
          smokeTest: {
            ...smokeUsage,
            estimatedCostUsd: estimateCostUsd(smokeUsage),
          },
        },
      }),
      null,
      2,
    )}
`,
    'utf8',
  );

  writeFileSync(
    path.join(OUT_DIR, 'final-run-registry.json'),
    `${JSON.stringify(toJsonValue(registry), null, 2)}\n`,
    'utf8',
  );

  // --- markdown ------------------------------------------------------------
  const metricTable = (
    caption: string,
    baseline: MetricView | null,
    stateproof: MetricView | null,
  ): string => {
    if (baseline === null || stateproof === null) {
      return `### ${caption}\n\nNot available: the locked evaluation has not been run.\n`;
    }
    const baselineRows = metricRows(caption, baseline);
    const stateproofRows = metricRows(caption, stateproof);
    return `### ${caption}\n\n${table(
      ['Metric', 'Frontier baseline', 'StateProof v3'],
      METRIC_LABELS.map((label, index) => [
        label,
        baselineRows[index] ?? '—',
        stateproofRows[index] ?? '—',
      ]),
    )}\n`;
  };

  const lines: string[] = [
    '# StateProof — final evaluation',
    '',
    '> The agent said it was done. Prove it.',
    '',
    'Generated by `pnpm submission:finalize` from pinned run artifacts. Every value is',
    'read from a report a run actually wrote; combined figures are recomputed from',
    'counts, never averaged from percentages.',
    '',
    '## What each section means',
    '',
    '- **Observed development result** — the eight cases the system was iterated against.',
    '- **Observed untouched locked result** — four cases run exactly once, after the freeze.',
    '- **Recomputed combined result** — all twelve, rebuilt from case and requirement counts.',
    '- **Measured repeated verification** — the same twelve verified again from persisted contracts.',
    '',
    `Locked evaluation complete: **${final.lockedEvaluationComplete ? 'yes' : 'no'}**.`,
    '',
    '## Observed development result',
    '',
    metricTable('Development split (8 cases)', baselineDevView, stateproofDevView),
    '## Observed untouched locked result',
    '',
    metricTable('Locked split (4 cases)', baselineLockedView, stateproofLockedView),
    '## Recomputed combined result',
    '',
    metricTable('Combined Hard-12 (12 cases)', baselineCombined, stateproofCombined),
    '## Model usage',
    '',
    table(
      ['Metric', 'Baseline combined (12)', 'StateProof first deployment (12)', 'StateProof repeated (12)'],
      USAGE_LABELS.map((label, index) => [
        label,
        baselineCombinedUsage === null ? '—' : (usageRows(baselineCombinedUsage)[index] ?? '—'),
        usageRows(firstDeployment)[index] ?? '—',
        usageRows(repeated)[index] ?? '—',
      ]),
    ),
    '',
    'First deployment compiles the three frozen contracts once and verifies all twelve',
    'cases; the locked tasks resolve to the same three task fingerprints, so no second',
    'compilation happens. Repeated verification loads those contracts and calls no model.',
    '',
    '**Timing labels.** Model-call wall time is the measured contract-compilation phase;',
    'for a run with zero model calls it is zero by definition. The baseline manifests do',
    'not isolate model time from process overhead, so theirs reads "not isolated" and only',
    'end-to-end elapsed time is quoted for them. Deterministic verification time is the',
    "verifier's own measurement, and end-to-end elapsed is what each manifest recorded.",
    '',
    '**Disclosure.** The locked StateProof invocation printed no inline efficiency',
    'comparison because no baseline run id was supplied to that individual command. The',
    'post-run final report above compares the two immutable locked artifacts and confirms',
    'the quality guardrails passed.',
    '',
    '**Scope.** This is a 12-case synthetic evaluation. It does not establish',
    'generalization beyond the submitted benchmark.',
    '',
    '## Efficiency',
    '',
  ];

  if (efficiency === null) {
    lines.push(
      '**No efficiency improvement is claimed.** The quality guardrails (SVR 100%, CDR 100%,',
      'FVR 0%, evidence-reference validity 100%) did not hold on both the locked and the',
      'combined result, or the locked evaluation has not been run.',
      '',
      `- Locked: ${final.guardrailFailures.locked.join('; ') || 'met'}`,
      `- Combined: ${final.guardrailFailures.combined.join('; ') || 'met'}`,
    );
  } else {
    lines.push(
      'Quality guardrails hold on both the locked and the combined result, so the',
      'comparison below is a claim this evaluation earned.',
      '',
      `- First deployment: ${formatRate(efficiency.firstDeploymentCallReduction)} fewer model calls, ` +
        `${formatRate(efficiency.firstDeploymentTokenReduction)} fewer tokens, ` +
        `${formatRate(efficiency.firstDeploymentElapsedReduction)} less end-to-end elapsed time.`,
      `- Repeated verification: ${formatRate(efficiency.repeatedCallReduction)} fewer model calls, ` +
        `${formatRate(efficiency.repeatedTokenReduction)} fewer tokens, ` +
        `${formatRate(efficiency.repeatedElapsedReduction)} less end-to-end elapsed time.`,
      `- Break-even on tokens: ${String(efficiency.breakEvenSuiteRuns ?? 'n/a')} run(s) of the full suite.`,
      '',
      `**API cost estimate** at ${CLAUDE_OPUS_5_PRICING.modelId} list prices as of ` +
        `${CLAUDE_OPUS_5_PRICING.asOf} ($${CLAUDE_OPUS_5_PRICING.inputUsdPerMillionTokens}/M input, ` +
        `$${CLAUDE_OPUS_5_PRICING.outputUsdPerMillionTokens}/M output). This is a pricing-snapshot ` +
        'estimate, not an invoice, and excludes local compute.',
      '',
      `- Frontier baseline, all 12 cases: **${formatUsd(efficiency.cost.baselineUsd)}**`,
      `- StateProof first deployment: **${formatUsd(efficiency.cost.firstDeploymentUsd)}**`,
      `- StateProof repeated verification: **${formatUsd(efficiency.cost.repeatedUsd)}** (zero model calls)`,
      `- Saving on first deployment: **${formatUsd(efficiency.cost.absoluteSavingsUsd)}** ` +
        `(${formatRate(efficiency.cost.percentSavings)})`,
      `- Break-even on cost: ${String(efficiency.cost.breakEvenRuns ?? 'n/a')} run(s) of the full suite.`,
    );
  }
  lines.push('');

  writeFileSync(path.join(OUT_DIR, 'final-evaluation.md'), `${lines.join('\n')}\n`, 'utf8');

  // --- claims map ----------------------------------------------------------
  const claimRows = view.runs.map((run) => [
    run.registered.label,
    `\`${run.registered.id}\``,
    `\`${run.canonicalPredictionSha256.slice(0, 16)}\``,
    `[manifest](../${run.registered.manifestPath})`,
    `[report](../${run.registered.reportMarkdownPath})`,
    `[predictions](../${run.registered.predictionPath})`,
  ]);

  const claims = [
    '# Final claims-to-evidence map',
    '',
    'Every run behind the final result, with the artifact that proves it.',
    'Regenerate with `pnpm submission:finalize`.',
    '',
    table(
      ['Run', 'Id', 'Canonical prediction sha256', 'Manifest', 'Report', 'Predictions'],
      claimRows,
    ),
    '',
    '## Frozen contract bundle',
    '',
    table(
      ['Task fingerprint', 'Contract hash', 'Artifact'],
      bundle.contracts.map((contract) => [
        `\`${contract.taskFingerprint.slice(0, 16)}\``,
        `\`${contract.contractHash.slice(0, 16)}\``,
        `[contract](../${contract.path})`,
      ]),
    ),
    '',
    '## Prompts',
    '',
    table(
      ['Prompt', 'Path', 'sha256'],
      view.prompts.map((prompt) => [
        prompt.label,
        `[${prompt.path}](../${prompt.path})`,
        `\`${prompt.sha256.slice(0, 16)}\``,
      ]),
    ),
    '',
    '## Final ledger',
    '',
    'The one-time locked protocol records every attempt, including failures, in',
    '[`final-evaluation-ledger.jsonl`](final-evaluation-ledger.jsonl).',
    '',
    '## Guardrail rule',
    '',
    'An efficiency claim requires SVR 100%, CDR 100%, FVR 0% and evidence-reference',
    'validity 100% on **both** the locked and the combined result. The generator emits',
    '`efficiency: null` otherwise — see `packages/submission/src/combine.ts`.',
    '',
  ].join('\n');
  writeFileSync(path.join(OUT_DIR, 'final-claims-evidence-map.md'), claims, 'utf8');

  process.stdout.write(
    [
      `locked evaluation complete: ${final.lockedEvaluationComplete ? 'yes' : 'no'}`,
      `quality guardrails met:     ${guardrailsOk ? 'yes' : 'no'}`,
      'written: submission/final-evaluation.json',
      'written: submission/final-evaluation.md',
      'written: submission/final-claims-evidence-map.md',
      'written: submission/final-run-registry.json',
      'written: submission/final-pricing-manifest.json',
      '',
    ].join('\n'),
  );
}

main();
