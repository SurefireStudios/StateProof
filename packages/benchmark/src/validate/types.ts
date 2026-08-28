import type { RunVerdict } from '@stateproof/core';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  readonly caseId: string;
  readonly check: string;
  readonly severity: IssueSeverity;
  readonly message: string;
}

export interface CaseValidationReport {
  readonly caseId: string;
  readonly issues: ValidationIssue[];
  /** Deterministic verdict produced by replaying the gold contract. */
  readonly computedVerdict: RunVerdict;
  readonly agentVisibleHash: string;
}

export interface BenchmarkValidationReport {
  readonly caseReports: CaseValidationReport[];
  readonly issues: ValidationIssue[];
  readonly datasetHash: string;
  readonly ok: boolean;
}

export function errorsOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}
