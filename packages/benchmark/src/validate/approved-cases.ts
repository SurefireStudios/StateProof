import type { OverallVerdict, Split } from '@stateproof/core';

/**
 * The approved PhantomBench-12 case registry, transcribed from
 * `04_PHANTOMBENCH_12_CASE_MATRIX.md`.
 *
 * This is human-only data. It exists so fixture validation can catch a case
 * that has silently drifted from the canonical matrix - a renamed id, a
 * flipped gold verdict, a case moved between splits, or a changed isolated
 * failure. It is never reachable from the agent-visible loader.
 */
export interface ApprovedCase {
  readonly caseId: string;
  readonly template: 'A' | 'B' | 'C';
  readonly split: Split;
  readonly goldVerdict: Extract<OverallVerdict, 'PASS' | 'FAIL'>;
  /** The single must-pass requirement an invalid case must violate. */
  readonly isolatedFailureRequirementId: string | null;
}

export const APPROVED_CASES: readonly ApprovedCase[] = [
  { caseId: 'PB-A01', template: 'A', split: 'development', goldVerdict: 'PASS', isolatedFailureRequirementId: null },
  { caseId: 'PB-A02', template: 'A', split: 'development', goldVerdict: 'PASS', isolatedFailureRequirementId: null },
  { caseId: 'PB-A03', template: 'A', split: 'development', goldVerdict: 'FAIL', isolatedFailureRequirementId: 'A-PROC-01' },
  { caseId: 'PB-A04', template: 'A', split: 'locked', goldVerdict: 'FAIL', isolatedFailureRequirementId: 'A-OUT-02' },
  { caseId: 'PB-B01', template: 'B', split: 'development', goldVerdict: 'PASS', isolatedFailureRequirementId: null },
  { caseId: 'PB-B02', template: 'B', split: 'locked', goldVerdict: 'PASS', isolatedFailureRequirementId: null },
  { caseId: 'PB-B03', template: 'B', split: 'development', goldVerdict: 'FAIL', isolatedFailureRequirementId: 'B-OUT-01' },
  { caseId: 'PB-B04', template: 'B', split: 'development', goldVerdict: 'FAIL', isolatedFailureRequirementId: 'B-OUT-03' },
  { caseId: 'PB-C01', template: 'C', split: 'development', goldVerdict: 'PASS', isolatedFailureRequirementId: null },
  { caseId: 'PB-C02', template: 'C', split: 'locked', goldVerdict: 'PASS', isolatedFailureRequirementId: null },
  { caseId: 'PB-C03', template: 'C', split: 'development', goldVerdict: 'FAIL', isolatedFailureRequirementId: 'C-PROH-01' },
  { caseId: 'PB-C04', template: 'C', split: 'locked', goldVerdict: 'FAIL', isolatedFailureRequirementId: 'C-SCOPE-01' },
];

/** Targets from the canonical matrix, checked once the set is complete. */
export const APPROVED_TOTALS = {
  cases: 12,
  development: 8,
  locked: 4,
  goldPass: 6,
  goldFail: 6,
} as const;

export function approvedCase(caseId: string): ApprovedCase | undefined {
  return APPROVED_CASES.find((entry) => entry.caseId === caseId);
}

export function approvedCaseIds(): string[] {
  return APPROVED_CASES.map((entry) => entry.caseId);
}

export function approvedCaseIdsForSplit(split: Split): string[] {
  return APPROVED_CASES.filter((entry) => entry.split === split).map((entry) => entry.caseId);
}
