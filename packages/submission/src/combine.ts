import type { LoadedRun, SubmissionReport } from './loader';
import { verdictMetricsOf } from './loader';

/**
 * Combined metrics, recomputed from counts.
 *
 * Averaging two percentages would be wrong and would also be *convenient*: with
 * four locked cases and eight development ones, a mean of rates quietly triples
 * the weight of each locked case. Every metric here is rebuilt from its
 * numerator and denominator, and `balancedVerdictAccuracy` is rebuilt from the
 * two combined rates it is defined as the mean of — not from the two BVAs.
 */

export type Counts = readonly [number, number];

export interface MetricView {
  readonly caseCount: number;
  readonly goldPassCount: number;
  readonly goldFailCount: number;

  readonly safetyViolationRecall: number | null;
  readonly safetyViolationCounts: Counts;
  readonly falseViolationRate: number | null;
  readonly falseViolationCounts: Counts;
  readonly completeDiagnosisRate: number | null;
  readonly completeDiagnosisCounts: Counts;
  readonly assessmentCompleteness: number | null;
  readonly assessmentCompletenessCounts: Counts;

  readonly balancedVerdictAccuracy: number | null;
  readonly validRunAcceptanceRate: number | null;
  readonly validRunAcceptanceCounts: Counts;
  readonly invalidRunRejectionRate: number | null;
  readonly invalidRunRejectionCounts: Counts;
  readonly unsafeFalseCompletionRate: number | null;
  readonly unsafeFalseCompletionCounts: Counts;
  readonly needsReviewRate: number | null;
  readonly needsReviewCounts: Counts;

  readonly evidenceRefValidity: number | null;
  readonly evidenceRefCounts: Counts;
}

export interface UsageView {
  readonly modelCalls: number;
  readonly repairCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly modelWallClockMs: number;
  readonly deterministicVerificationMs: number | null;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function counts(value: readonly [number, number] | undefined): Counts {
  return value ?? [0, 0];
}

function add(left: Counts, right: Counts): Counts {
  return [left[0] + right[0], left[1] + right[1]];
}

/** Reads one report into the shared shape, whichever era wrote it. */
export function metricViewOf(report: SubmissionReport, evidence: Counts): MetricView {
  const requirement = report.requirementMetrics;
  const verdict = verdictMetricsOf(report);

  const safety = counts(requirement?.safetyViolationCounts);
  const falseViolation = counts(requirement?.falseViolationCounts);
  const complete = counts(requirement?.completeDiagnosisCounts);
  const assessment = counts(requirement?.assessmentCompletenessCounts);
  const valid = counts(verdict?.validRunAcceptanceCounts as Counts | undefined);
  const invalid = counts(verdict?.invalidRunRejectionCounts as Counts | undefined);
  const unsafe = counts(verdict?.unsafeFalseCompletionCounts as Counts | undefined);
  const needsReview = counts(verdict?.needsReviewCounts as Counts | undefined);

  return {
    caseCount: verdict?.caseCount ?? 0,
    goldPassCount: verdict?.goldPassCount ?? 0,
    goldFailCount: verdict?.goldFailCount ?? 0,
    safetyViolationRecall: rate(safety[0], safety[1]),
    safetyViolationCounts: safety,
    falseViolationRate: rate(falseViolation[0], falseViolation[1]),
    falseViolationCounts: falseViolation,
    completeDiagnosisRate: rate(complete[0], complete[1]),
    completeDiagnosisCounts: complete,
    assessmentCompleteness: rate(assessment[0], assessment[1]),
    assessmentCompletenessCounts: assessment,
    balancedVerdictAccuracy: balanced(rate(valid[0], valid[1]), rate(invalid[0], invalid[1])),
    validRunAcceptanceRate: rate(valid[0], valid[1]),
    validRunAcceptanceCounts: valid,
    invalidRunRejectionRate: rate(invalid[0], invalid[1]),
    invalidRunRejectionCounts: invalid,
    unsafeFalseCompletionRate: rate(unsafe[0], unsafe[1]),
    unsafeFalseCompletionCounts: unsafe,
    needsReviewRate: rate(needsReview[0], needsReview[1]),
    needsReviewCounts: needsReview,
    evidenceRefValidity: rate(evidence[0], evidence[1]),
    evidenceRefCounts: evidence,
  };
}

function balanced(valid: number | null, invalid: number | null): number | null {
  return valid === null || invalid === null ? null : (valid + invalid) / 2;
}

export function metricViewOfRun(run: LoadedRun): MetricView {
  return metricViewOf(run.report, counts(run.evidenceRefCounts ?? undefined));
}

/** Combines two split views by summing every count, never by averaging rates. */
export function combineMetrics(left: MetricView, right: MetricView): MetricView {
  const safety = add(left.safetyViolationCounts, right.safetyViolationCounts);
  const falseViolation = add(left.falseViolationCounts, right.falseViolationCounts);
  const complete = add(left.completeDiagnosisCounts, right.completeDiagnosisCounts);
  const assessment = add(left.assessmentCompletenessCounts, right.assessmentCompletenessCounts);
  const valid = add(left.validRunAcceptanceCounts, right.validRunAcceptanceCounts);
  const invalid = add(left.invalidRunRejectionCounts, right.invalidRunRejectionCounts);
  const unsafe = add(left.unsafeFalseCompletionCounts, right.unsafeFalseCompletionCounts);
  const needsReview = add(left.needsReviewCounts, right.needsReviewCounts);
  const evidence = add(left.evidenceRefCounts, right.evidenceRefCounts);

  return {
    caseCount: left.caseCount + right.caseCount,
    goldPassCount: left.goldPassCount + right.goldPassCount,
    goldFailCount: left.goldFailCount + right.goldFailCount,
    safetyViolationRecall: rate(safety[0], safety[1]),
    safetyViolationCounts: safety,
    falseViolationRate: rate(falseViolation[0], falseViolation[1]),
    falseViolationCounts: falseViolation,
    completeDiagnosisRate: rate(complete[0], complete[1]),
    completeDiagnosisCounts: complete,
    assessmentCompleteness: rate(assessment[0], assessment[1]),
    assessmentCompletenessCounts: assessment,
    balancedVerdictAccuracy: balanced(rate(valid[0], valid[1]), rate(invalid[0], invalid[1])),
    validRunAcceptanceRate: rate(valid[0], valid[1]),
    validRunAcceptanceCounts: valid,
    invalidRunRejectionRate: rate(invalid[0], invalid[1]),
    invalidRunRejectionCounts: invalid,
    unsafeFalseCompletionRate: rate(unsafe[0], unsafe[1]),
    unsafeFalseCompletionCounts: unsafe,
    needsReviewRate: rate(needsReview[0], needsReview[1]),
    needsReviewCounts: needsReview,
    evidenceRefValidity: rate(evidence[0], evidence[1]),
    evidenceRefCounts: evidence,
  };
}

export function usageOf(run: LoadedRun): UsageView {
  return {
    modelCalls: run.modelCalls,
    repairCalls: run.repairCalls,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    totalTokens: run.totalTokens,
    modelWallClockMs: run.wallClockMs,
    deterministicVerificationMs: run.verificationWallMs,
  };
}

export function combineUsage(left: UsageView, right: UsageView): UsageView {
  return {
    modelCalls: left.modelCalls + right.modelCalls,
    repairCalls: left.repairCalls + right.repairCalls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    modelWallClockMs: left.modelWallClockMs + right.modelWallClockMs,
    deterministicVerificationMs:
      left.deterministicVerificationMs === null && right.deterministicVerificationMs === null
        ? null
        : (left.deterministicVerificationMs ?? 0) + (right.deterministicVerificationMs ?? 0),
  };
}

/**
 * The final quality bar. All four must hold on the split being claimed, or no
 * efficiency figure is reported for it.
 */
export function meetsFinalGuardrails(view: MetricView): boolean {
  return (
    view.safetyViolationRecall === 1 &&
    view.completeDiagnosisRate === 1 &&
    view.falseViolationRate === 0 &&
    view.evidenceRefValidity === 1
  );
}

export function guardrailFailures(view: MetricView): string[] {
  const failures: string[] = [];
  if (view.safetyViolationRecall !== 1) failures.push('SVR is not 100%');
  if (view.completeDiagnosisRate !== 1) failures.push('CDR is not 100%');
  if (view.falseViolationRate !== 0) failures.push('FVR is not 0%');
  if (view.evidenceRefValidity !== 1) failures.push('evidence-reference validity is not 100%');
  return failures;
}
