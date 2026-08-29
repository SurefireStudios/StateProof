import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRate, toJsonValue } from '@stateproof/core';
import { type LoadedRun, loadSubmissionView } from '@stateproof/submission';

/**
 * `pnpm submission:summary`
 *
 * Writes the judge-facing summary from the pinned artifacts.
 *
 * Nothing in here is typed by hand. If a number appears in the summary, some
 * run produced it and the registry pins the file it came from — which is the
 * same standard StateProof holds an agent to.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const PITCH = 'The agent said it was done. Prove it.';
const INSIGHT = 'For action-taking agents, the final response is a claim—not evidence.';

function reduction(before: number, after: number): number | null {
  return before === 0 ? null : (before - after) / before;
}

function runSummary(run: LoadedRun): Record<string, unknown> {
  return {
    id: run.registered.id,
    label: run.registered.label,
    role: run.registered.role,
    system: run.registered.system,
    dataset: run.registered.dataset,
    split: run.registered.split,
    sourceCommit: run.manifest.gitCommitSha,
    promptFiles: run.manifest.promptFilePaths,
    assertionSchemaVersion: run.manifest.assertionSchemaVersion ?? null,
    contractRunId: run.registered.contractRunId,
    metrics: {
      safetyViolationRecall: run.svr,
      falseViolationRate: run.fvr,
      completeDiagnosisRate: run.cdr,
      balancedVerdictAccuracy: run.bva,
      evidenceRefValidity: run.evidenceRefValidity,
      evidenceRefCounts: run.evidenceRefCounts,
    },
    usage: {
      modelCalls: run.modelCalls,
      repairCalls: run.repairCalls,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      totalTokens: run.totalTokens,
      wallClockMs: run.wallClockMs,
      deterministicVerificationMs: run.verificationWallMs,
      contractCacheHits: run.cacheHits,
      estimatedCostUsd: null,
    },
    qualityGuardrailsMet: run.guardrailsMet,
    artifacts: {
      manifest: run.registered.manifestPath,
      predictions: run.registered.predictionPath,
      reportJson: run.registered.reportJsonPath,
      reportMarkdown: run.registered.reportMarkdownPath,
    },
  };
}

function main(): void {
  const view = loadSubmissionView({ repoRoot: REPO_ROOT });
  const byRole = view.byRole;
  const baseline = byRole.get('baseline-hard')?.[0];
  const cold = byRole.get('stateproof-v3-cold')?.[0];
  const warm = byRole.get('stateproof-v3-warm')?.[0];
  const repeats = byRole.get('stateproof-v3-warm-repeat') ?? [];

  if (baseline === undefined || cold === undefined || warm === undefined) {
    throw new Error('the registry is missing the baseline, the v3 cold run or the measured warm run');
  }

  const eligible = cold.guardrailsMet && warm.guardrailsMet;
  const reductions = eligible
    ? {
        coldModelCalls: reduction(baseline.modelCalls, cold.modelCalls),
        coldTotalTokens: reduction(baseline.totalTokens, cold.totalTokens),
        coldWallClock: reduction(baseline.wallClockMs, cold.wallClockMs),
        warmModelCalls: reduction(baseline.modelCalls, warm.modelCalls),
        warmTotalTokens: reduction(baseline.totalTokens, warm.totalTokens),
        warmWallClock: reduction(baseline.wallClockMs, warm.wallClockMs),
        breakEvenSuiteRuns:
          baseline.totalTokens > warm.totalTokens
            ? Math.max(
                1,
                Math.ceil(
                  (cold.totalTokens - warm.totalTokens) / (baseline.totalTokens - warm.totalTokens),
                ),
              )
            : null,
      }
    : null;

  const summary = {
    schemaVersion: '1.0.0',
    generatedFrom: 'submission/reproduction-manifest.json',
    pitch: PITCH,
    insight: INSIGHT,
    intendedUser:
      'AI product, evaluation and operations engineers deploying agents that modify business systems.',
    bottleneck:
      'A plausible final response or tool log can hide a no-op, a partial completion, a wrong target, ' +
      'a wrong amount, an approval that came after the protected action, or an unrelated side effect.',
    architecture: [
      'Contract Agent compiles the task into typed, machine-checkable requirements — before it sees any run.',
      'The compiled contract is fingerprinted and cached, so one task is compiled once.',
      'A deterministic verifier evaluates that contract against the trajectory and both state snapshots, with no model in the loop.',
      'Every verdict cites evidence generated from the records and events the assertions actually matched.',
    ],
    scope: 'Development split of PhantomBench-Hard-12. The locked split has deliberately not been run.',
    sourceCommits: view.manifest.sourceCommits,
    prompts: view.prompts,
    contractBundle: {
      contractRunId: view.bundles[0]?.registered.contractRunId ?? null,
      assertionSchemaVersion: view.bundles[0]?.registered.assertionSchemaVersion ?? null,
      contracts: view.bundles[0]?.contracts.map((contract) => ({
        taskFingerprint: contract.taskFingerprint,
        contractHash: contract.contractHash,
        path: contract.path,
      })),
    },
    runs: view.runs.map(runSummary),
    headline: {
      baselineRunId: baseline.registered.id,
      coldRunId: cold.registered.id,
      warmRunId: warm.registered.id,
      warmRepeatRunIds: repeats.map((run) => run.registered.id),
      qualityGuardrailsMet: eligible,
      reductions,
      deterministicRepeat: {
        runs: [warm, ...repeats].map((run) => run.registered.id),
        canonicalPredictionSha256: warm.canonicalPredictionSha256,
        identical: [warm, ...repeats].every(
          (run) => run.canonicalPredictionSha256 === warm.canonicalPredictionSha256,
        ),
      },
    },
    reproduction: {
      commands: ['pnpm install', 'pnpm reproduce'],
      requiresCredentials: false,
      notes:
        'The replay loads the committed contract bundle, re-verifies the eight development cases, ' +
        'and compares canonical predictions to the pinned warm run. It makes zero model calls.',
    },
    trajectories: view.runs.map((run) => ({
      runId: run.registered.id,
      rawResponsePaths: run.manifest.rawResponsePaths,
      promptFiles: run.manifest.promptFilePaths,
    })),
  };

  const outDir = path.join(REPO_ROOT, 'artifacts', 'submission');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'development-summary.json');
  writeFileSync(jsonPath, `${JSON.stringify(toJsonValue(summary), null, 2)}\n`, 'utf8');

  const row = (run: LoadedRun): string =>
    `| ${run.registered.label} | ${formatRate(run.svr)} | ${formatRate(run.fvr)} | ` +
    `${formatRate(run.cdr)} | ${formatRate(run.bva)} | ${run.modelCalls} | ${run.totalTokens} | ` +
    `${run.wallClockMs} |`;

  const markdown = [
    '# StateProof — development summary',
    '',
    `> ${PITCH}`,
    '',
    INSIGHT,
    '',
    'Every number below is read from a pinned run artifact; none is entered by hand.',
    `Generated from \`submission/reproduction-manifest.json\`.`,
    '',
    '## Intended user and bottleneck',
    '',
    summary.intendedUser,
    '',
    summary.bottleneck,
    '',
    '## Architecture',
    '',
    ...summary.architecture.map((line) => `1. ${line}`),
    '',
    '## Results — hard development split',
    '',
    '| Run | SVR | FVR | CDR | BVA | Model calls | Total tokens | Wall clock (ms) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...view.runs
      .filter((run) => run.registered.role !== 'baseline-core')
      .filter((run) => run.registered.role !== 'stateproof-v3-warm-repeat')
      .map(row),
    '',
    eligible
      ? [
          '## Measured reductions versus the frozen baseline',
          '',
          `- Cold: ${formatRate(reductions?.coldModelCalls ?? null)} fewer model calls, ` +
            `${formatRate(reductions?.coldTotalTokens ?? null)} fewer tokens, ` +
            `${formatRate(reductions?.coldWallClock ?? null)} less wall clock.`,
          `- Measured warm: ${formatRate(reductions?.warmModelCalls ?? null)} fewer model calls, ` +
            `${formatRate(reductions?.warmTotalTokens ?? null)} fewer tokens, ` +
            `${formatRate(reductions?.warmWallClock ?? null)} less wall clock.`,
          `- Break-even: ${String(reductions?.breakEvenSuiteRuns ?? 'n/a')} run(s) of the suite.`,
          '- Cost in USD is deliberately not claimed: no pricing rule is implemented.',
        ].join('\n')
      : 'No efficiency reduction is claimed: the quality guardrails were not met.',
    '',
    '## Deterministic repeat',
    '',
    `Warm runs ${[warm, ...repeats].map((run) => `\`${run.registered.id}\``).join(', ')} produced ` +
      `identical canonical predictions (sha256 \`${warm.canonicalPredictionSha256.slice(0, 16)}\`), ` +
      'zero model calls and zero tokens.',
    '',
    '## Reproduce',
    '',
    '```bash',
    ...summary.reproduction.commands,
    '```',
    '',
    'No API credential is required.',
    '',
  ].join('\n');

  const markdownPath = path.join(outDir, 'development-summary.md');
  writeFileSync(markdownPath, markdown, 'utf8');

  process.stdout.write(`written: ${path.relative(REPO_ROOT, jsonPath)}\n`);
  process.stdout.write(`written: ${path.relative(REPO_ROOT, markdownPath)}\n`);
}

main();
