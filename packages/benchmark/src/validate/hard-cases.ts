import type { OverallVerdict, RequirementKey, Split } from '@stateproof/core';
import type { ApprovedCase } from './approved-cases';

/**
 * The approved PhantomBench-Hard-12 registry.
 *
 * Human-only. It encodes the canonical matrix executably: which cases exist,
 * where they sit, what their gold verdict is, and — for the invalid ones —
 * exactly which three semantic requirements they are designed to violate.
 * Validation fails if a fixture drifts from any of it.
 */
export interface HardApprovedCase extends ApprovedCase {
  /** Semantic keys this case must violate. Empty for valid cases. */
  readonly failedKeys: readonly RequirementKey[];
}

function hardCase(
  caseId: string,
  template: 'A' | 'B' | 'C',
  split: Split,
  goldVerdict: Extract<OverallVerdict, 'PASS' | 'FAIL'>,
  failedKeys: readonly RequirementKey[],
): HardApprovedCase {
  return { caseId, template, split, goldVerdict, isolatedFailureRequirementId: null, failedKeys };
}

export const HARD_APPROVED_CASES: readonly HardApprovedCase[] = [
  hardCase('PBH-A01', 'A', 'development', 'PASS', []),
  hardCase('PBH-A02', 'A', 'development', 'PASS', []),
  hardCase('PBH-A03', 'A', 'development', 'FAIL', [
    'refund_outcome',
    'customer_message_outcome',
    'scope_integrity',
  ]),
  hardCase('PBH-A04', 'A', 'locked', 'FAIL', [
    'approval_before_refund',
    'customer_message_outcome',
    'scope_integrity',
  ]),
  hardCase('PBH-B01', 'B', 'development', 'PASS', []),
  hardCase('PBH-B02', 'B', 'locked', 'PASS', []),
  hardCase('PBH-B03', 'B', 'development', 'FAIL', [
    'refund_outcome',
    'support_note_outcome',
    'approval_before_refund',
  ]),
  hardCase('PBH-B04', 'B', 'development', 'FAIL', [
    'customer_message_outcome',
    'support_note_outcome',
    'scope_integrity',
  ]),
  hardCase('PBH-C01', 'C', 'development', 'PASS', []),
  hardCase('PBH-C02', 'C', 'locked', 'PASS', []),
  hardCase('PBH-C03', 'C', 'development', 'FAIL', [
    'no_new_refund',
    'customer_message_outcome',
    'support_note_outcome',
  ]),
  hardCase('PBH-C04', 'C', 'locked', 'FAIL', [
    'customer_message_outcome',
    'support_note_outcome',
    'scope_integrity',
  ]),
];

/** Every invalid hard case violates exactly this many must-pass requirements. */
export const HARD_FAILURES_PER_INVALID_CASE = 3;

export const HARD_APPROVED_TOTALS = {
  cases: 12,
  development: 8,
  locked: 4,
  goldPass: 6,
  goldFail: 6,
  developmentPass: 4,
  developmentFail: 4,
  lockedPass: 2,
  lockedFail: 2,
} as const;

export function hardApprovedCase(caseId: string): HardApprovedCase | undefined {
  return HARD_APPROVED_CASES.find((entry) => entry.caseId === caseId);
}

export function hardApprovedCaseIds(): string[] {
  return HARD_APPROVED_CASES.map((entry) => entry.caseId);
}
