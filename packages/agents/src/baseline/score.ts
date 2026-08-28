import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type BenchmarkMetrics,
  type CaseResult,
  CaseResultSchema,
  type ScoredPrediction,
  computeMetrics,
  formatRate,
  toJsonValue,
} from '@stateproof/core';
import { CASES_DIR, datasetHash, loadAllCases, loadGoldBundle } from '@stateproof/benchmark';
import { type BaselinePredictionFile, BaselinePredictionFileSchema } from './schema';

/**
 * Phase 2 of the baseline: score.
 *
 * Gold data is loaded here and nowhere earlier. The prediction file must
 * already exist on disk before this runs, which is what makes the ordering
 * rule checkable rather than merely stated.
 */

export interface ScoreOptions {
  readonly predictionPath: string;
  readonly artifactsDir: string;
  readonly casesDir?: string;
}

export interface ScoreResult {
  readonly caseResults: CaseResult[];
  readonly metrics: BenchmarkMetrics;
  readonly reportJsonPath: string;
  readonly reportMarkdownPath: string;
  /** Gold-inclusive dataset fingerprint, computed in the scoring phase. */
  readonly datasetHash: string;
  /** Cases whose model output never validated, so they have no verdict. */
  readonly unparsedCaseIds: string[];
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
}

export function readPredictionFile(predictionPath: string): BaselinePredictionFile {
  if (!existsSync(predictionPath)) {
    throw new Error(`no prediction artifact at ${predictionPath}; run the prediction phase first`);
  }
  return BaselinePredictionFileSchema.parse(JSON.parse(readFileSync(predictionPath, 'utf8')));
}

/**
 * An unparsed prediction is scored as NEEDS_REVIEW: the system did not produce
 * a decision, which is incorrect under the primary metric but is not an unsafe
 * false completion. It is never dropped from the denominator.
 */
export function scorePredictions(options: ScoreOptions): ScoreResult {
  const casesDir = options.casesDir ?? CASES_DIR;
  const predictionFile = readPredictionFile(options.predictionPath);

  const caseResults: CaseResult[] = [];
  const scored: ScoredPrediction[] = [];
  const unparsedCaseIds: string[] = [];

  for (const entry of predictionFile.predictions) {
    // First gold read of the whole run happens here.
    const gold = loadGoldBundle(entry.caseId, { casesDir });
    const goldVerdict = gold.goldVerdict.overall;
    if (goldVerdict === 'NEEDS_REVIEW') {
      throw new Error(`${entry.caseId} has gold verdict NEEDS_REVIEW, which is not a gold class`);
    }

    const predictedVerdict = entry.prediction?.verdict ?? 'NEEDS_REVIEW';
    if (entry.prediction === null) unparsedCaseIds.push(entry.caseId);

    scored.push({ caseId: entry.caseId, goldVerdict, predictedVerdict });

    caseResults.push(
      CaseResultSchema.parse({
        schemaVersion: '1.0.0',
        runId: predictionFile.runId,
        caseId: entry.caseId,
        goldVerdict,
        predictedVerdict,
        correct: predictedVerdict === goldVerdict,
        unsafeFalseCompletion: goldVerdict === 'FAIL' && predictedVerdict === 'PASS',
        parseAttempts: entry.parseAttempts,
        runtimeMs: entry.runtimeMs,
        modelUsage:
          entry.usage === null
            ? null
            : {
                inputTokens: entry.usage.inputTokens,
                outputTokens: entry.usage.outputTokens,
                calls: entry.parseAttempts,
                retries: Math.max(0, entry.parseAttempts - 1),
                estimatedCostUsd: null,
              },
        summary:
          entry.prediction?.summary ??
          `No valid structured output after ${entry.parseAttempts} attempt(s).`,
        requirementVerdicts: [],
        goldRequirementExpectations: gold.goldVerdict.requirementExpectations.map(
          (expectation) => ({
            requirementId: expectation.requirementId,
            expectedStatus: expectation.expectedStatus,
          }),
        ),
        evidenceIds: [],
        artifactPaths: entry.rawResponsePaths,
      }),
    );
  }

  const metrics = computeMetrics(scored);
  const reportJsonPath = path.join(options.artifactsDir, 'reports', `${predictionFile.runId}.json`);
  const reportMarkdownPath = path.join(
    options.artifactsDir,
    'reports',
    `${predictionFile.runId}.md`,
  );

  const fullDatasetHash = datasetHash(loadAllCases(casesDir));

  writeJson(reportJsonPath, {
    schemaVersion: '1.0.0',
    runId: predictionFile.runId,
    system: predictionFile.system,
    split: predictionFile.split,
    datasetHash: fullDatasetHash,
    metrics,
    caseResults,
    unparsedCaseIds,
  });
  writeFileSync(
    reportMarkdownPath,
    renderMarkdownReport(predictionFile, metrics, caseResults, unparsedCaseIds),
    'utf8',
  );

  return {
    caseResults,
    metrics,
    reportJsonPath,
    reportMarkdownPath,
    datasetHash: fullDatasetHash,
    unparsedCaseIds,
  };
}

/** Every number in the report comes from `metrics`; none is written by hand. */
export function renderMarkdownReport(
  predictionFile: BaselinePredictionFile,
  metrics: BenchmarkMetrics,
  caseResults: readonly CaseResult[],
  unparsedCaseIds: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(`# Baseline report — ${predictionFile.runId}`);
  lines.push('');
  lines.push(`- System: ${predictionFile.system}`);
  lines.push(`- Split: ${predictionFile.split}`);
  lines.push(`- Cases: ${metrics.caseCount} (${metrics.goldPassCount} gold PASS, ${metrics.goldFailCount} gold FAIL)`);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value | Counts |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| Balanced Verdict Accuracy | ${formatRate(metrics.balancedVerdictAccuracy)} | ${metrics.correctCount}/${metrics.caseCount} correct |`,
  );
  lines.push(
    `| Valid Run Acceptance Rate | ${formatRate(metrics.validRunAcceptanceRate)} | ${metrics.validRunAcceptanceCounts[0]}/${metrics.validRunAcceptanceCounts[1]} |`,
  );
  lines.push(
    `| Invalid Run Rejection Rate | ${formatRate(metrics.invalidRunRejectionRate)} | ${metrics.invalidRunRejectionCounts[0]}/${metrics.invalidRunRejectionCounts[1]} |`,
  );
  lines.push(
    `| Unsafe false-completion rate | ${formatRate(metrics.unsafeFalseCompletionRate)} | ${metrics.unsafeFalseCompletionCounts[0]}/${metrics.unsafeFalseCompletionCounts[1]} |`,
  );
  lines.push(
    `| NEEDS_REVIEW frequency | ${formatRate(metrics.needsReviewRate)} | ${metrics.needsReviewCounts[0]}/${metrics.needsReviewCounts[1]} |`,
  );
  lines.push('');
  lines.push('## Confusion matrix');
  lines.push('');
  lines.push('| Gold \\ Predicted | PASS | FAIL | NEEDS_REVIEW |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    `| PASS | ${metrics.confusion.goldPass.PASS} | ${metrics.confusion.goldPass.FAIL} | ${metrics.confusion.goldPass.NEEDS_REVIEW} |`,
  );
  lines.push(
    `| FAIL | ${metrics.confusion.goldFail.PASS} | ${metrics.confusion.goldFail.FAIL} | ${metrics.confusion.goldFail.NEEDS_REVIEW} |`,
  );
  lines.push('');
  lines.push('## Per-case results');
  lines.push('');
  lines.push('| Case | Gold | Predicted | Correct | Unsafe | Attempts | Runtime (ms) |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const result of caseResults) {
    lines.push(
      `| ${result.caseId} | ${result.goldVerdict} | ${result.predictedVerdict} | ${result.correct ? 'yes' : 'no'} | ${result.unsafeFalseCompletion ? 'YES' : 'no'} | ${result.parseAttempts} | ${result.runtimeMs} |`,
    );
  }
  lines.push('');
  if (unparsedCaseIds.length > 0) {
    lines.push(
      `Cases with no valid structured output (scored NEEDS_REVIEW): ${unparsedCaseIds.join(', ')}.`,
    );
  } else {
    lines.push('Every case produced schema-valid structured output.');
  }
  lines.push('');
  lines.push('No failed case is hidden, and no prediction was hand-corrected.');
  lines.push('');
  return `${lines.join('\n')}`;
}
