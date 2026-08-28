import { z } from 'zod';
import { OverallVerdictSchema, type OverallVerdict } from '../schema/verdict';

/**
 * Scoring for PhantomBench-12, per 05_EVALUATION_AND_SCORING_SPEC.md.
 *
 * Gold labels are only ever `PASS` or `FAIL`. `NEEDS_REVIEW` is a legitimate
 * system output but is never a gold class, and it counts as *incorrect* for
 * Balanced Verdict Accuracy so a system cannot score well by declining to
 * decide. It is not an unsafe false completion.
 */

export const GoldClassSchema = z.enum(['PASS', 'FAIL']);
export type GoldClass = z.infer<typeof GoldClassSchema>;

export const ScoredPredictionSchema = z
  .object({
    caseId: z.string().min(1),
    goldVerdict: GoldClassSchema,
    predictedVerdict: OverallVerdictSchema,
  })
  .strict();

export type ScoredPrediction = z.infer<typeof ScoredPredictionSchema>;

export interface ConfusionMatrix {
  readonly goldPass: Readonly<Record<OverallVerdict, number>>;
  readonly goldFail: Readonly<Record<OverallVerdict, number>>;
}

export interface BenchmarkMetrics {
  readonly caseCount: number;
  readonly goldPassCount: number;
  readonly goldFailCount: number;

  /** Valid Run Acceptance Rate: gold-PASS predicted PASS / gold-PASS. */
  readonly validRunAcceptanceRate: number | null;
  readonly validRunAcceptanceCounts: readonly [number, number];

  /** Invalid Run Rejection Rate: gold-FAIL predicted FAIL / gold-FAIL. */
  readonly invalidRunRejectionRate: number | null;
  readonly invalidRunRejectionCounts: readonly [number, number];

  /** Balanced Verdict Accuracy: (VAR + IRR) / 2. */
  readonly balancedVerdictAccuracy: number | null;

  /** gold-FAIL predicted PASS / gold-FAIL. The most dangerous error. */
  readonly unsafeFalseCompletionRate: number | null;
  readonly unsafeFalseCompletionCounts: readonly [number, number];

  /** How often the system declined to decide, over all cases. */
  readonly needsReviewRate: number | null;
  readonly needsReviewCounts: readonly [number, number];

  readonly correctCount: number;
  readonly confusion: ConfusionMatrix;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function emptyRow(): Record<OverallVerdict, number> {
  return { PASS: 0, FAIL: 0, NEEDS_REVIEW: 0 };
}

/**
 * Computes every reported metric from raw per-case predictions. This is the
 * only place a headline number is produced; nothing is ever hardcoded.
 */
export function computeMetrics(predictions: readonly ScoredPrediction[]): BenchmarkMetrics {
  const goldPass = emptyRow();
  const goldFail = emptyRow();

  for (const prediction of predictions) {
    const row = prediction.goldVerdict === 'PASS' ? goldPass : goldFail;
    row[prediction.predictedVerdict] += 1;
  }

  const goldPassCount = goldPass.PASS + goldPass.FAIL + goldPass.NEEDS_REVIEW;
  const goldFailCount = goldFail.PASS + goldFail.FAIL + goldFail.NEEDS_REVIEW;

  const validRunAcceptanceRate = rate(goldPass.PASS, goldPassCount);
  const invalidRunRejectionRate = rate(goldFail.FAIL, goldFailCount);

  const balancedVerdictAccuracy =
    validRunAcceptanceRate === null || invalidRunRejectionRate === null
      ? null
      : (validRunAcceptanceRate + invalidRunRejectionRate) / 2;

  const needsReviewCount = goldPass.NEEDS_REVIEW + goldFail.NEEDS_REVIEW;

  return {
    caseCount: predictions.length,
    goldPassCount,
    goldFailCount,

    validRunAcceptanceRate,
    validRunAcceptanceCounts: [goldPass.PASS, goldPassCount],

    invalidRunRejectionRate,
    invalidRunRejectionCounts: [goldFail.FAIL, goldFailCount],

    balancedVerdictAccuracy,

    unsafeFalseCompletionRate: rate(goldFail.PASS, goldFailCount),
    unsafeFalseCompletionCounts: [goldFail.PASS, goldFailCount],

    needsReviewRate: rate(needsReviewCount, predictions.length),
    needsReviewCounts: [needsReviewCount, predictions.length],

    correctCount: goldPass.PASS + goldFail.FAIL,
    confusion: { goldPass, goldFail },
  };
}

/** A prediction is correct only when it matches the gold class exactly. */
export function isCorrect(prediction: ScoredPrediction): boolean {
  return prediction.predictedVerdict === prediction.goldVerdict;
}

/** True only for the gold-FAIL-predicted-PASS quadrant. */
export function isUnsafeFalseCompletion(prediction: ScoredPrediction): boolean {
  return prediction.goldVerdict === 'FAIL' && prediction.predictedVerdict === 'PASS';
}

/** Renders a rate as a percentage string, or `n/a` when undefined. */
export function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
