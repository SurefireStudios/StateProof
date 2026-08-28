import {
  type BenchmarkCase,
  type RequirementKey,
  requirementKeyFor,
} from '@stateproof/core';
import { datasetHash, loadAllCases } from '../load-gold';
import { HARD_CASES_DIR, HARD_SPLITS_DIR } from '../paths';
import { caseIdsForSplit } from '../splits';
import { validateContractConsistency } from './contract-consistency';
import {
  HARD_APPROVED_TOTALS,
  HARD_FAILURES_PER_INVALID_CASE,
  hardApprovedCase,
  hardApprovedCaseIds,
} from './hard-cases';
import { validateCase } from './index';
import type { BenchmarkValidationReport, CaseValidationReport, ValidationIssue } from './types';

/**
 * Validation for PhantomBench-Hard-12.
 *
 * Everything the Core-12 validator proves still has to hold — schemas, replay
 * derivability, referential integrity, gold agreement. On top of that, the
 * hard suite has a failure *structure* to prove: each invalid case must
 * violate exactly three must-pass requirements, and exactly the three the
 * canonical matrix names, expressed as semantic keys rather than
 * template-specific requirement ids.
 */

function issue(caseId: string, check: string, message: string): ValidationIssue {
  return { caseId, check, severity: 'error', message };
}

/** Semantic keys a case's gold contract actually disproves, sorted. */
export function disprovenKeys(report: CaseValidationReport): RequirementKey[] {
  const keys = report.computedVerdict.requirementVerdicts
    .filter((verdict) => verdict.mustPass && verdict.status === 'disproven')
    .map((verdict) => requirementKeyFor(verdict.requirementId))
    .filter((key): key is RequirementKey => key !== undefined);
  return [...keys].sort();
}

function validateFailureStructure(
  benchmarkCase: BenchmarkCase,
  report: CaseValidationReport,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { caseId, metadata } = benchmarkCase;
  const approved = hardApprovedCase(caseId);
  if (approved === undefined) return issues;

  const disprovenVerdicts = report.computedVerdict.requirementVerdicts.filter(
    (verdict) => verdict.mustPass && verdict.status === 'disproven',
  );
  const disprovenIds = disprovenVerdicts.map((verdict) => verdict.requirementId).sort();
  const actualKeys = disprovenKeys(report);
  const expectedKeys = [...approved.failedKeys].sort();

  if (approved.goldVerdict === 'PASS') {
    if (disprovenVerdicts.length > 0) {
      issues.push(
        issue(
          caseId,
          'hard-failure-structure',
          `valid case violates ${disprovenVerdicts.length} must-pass requirement(s): ${disprovenIds.join(', ')}`,
        ),
      );
    }
    if (metadata.multiFault) {
      issues.push(issue(caseId, 'hard-failure-structure', 'valid cases must set multiFault: false'));
    }
    return issues;
  }

  if (!metadata.multiFault) {
    issues.push(issue(caseId, 'hard-failure-structure', 'invalid hard cases must set multiFault: true'));
  }
  if (disprovenVerdicts.length !== HARD_FAILURES_PER_INVALID_CASE) {
    issues.push(
      issue(
        caseId,
        'hard-failure-structure',
        `violates ${disprovenVerdicts.length} must-pass requirement(s) (${disprovenIds.join(', ')}); every invalid hard case must violate exactly ${HARD_FAILURES_PER_INVALID_CASE}`,
      ),
    );
  }
  if (actualKeys.join(',') !== expectedKeys.join(',')) {
    issues.push(
      issue(
        caseId,
        'hard-failure-structure',
        `violates keys [${actualKeys.join(', ')}] but the matrix declares [${expectedKeys.join(', ')}]`,
      ),
    );
  }

  const declaredIds = [...metadata.failedRequirementIds].sort();
  if (declaredIds.join(',') !== disprovenIds.join(',')) {
    issues.push(
      issue(
        caseId,
        'hard-failure-structure',
        `metadata declares failed requirements [${declaredIds.join(', ')}] but the verifier disproves [${disprovenIds.join(', ')}]`,
      ),
    );
  }

  for (const requirementId of disprovenIds) {
    if (requirementKeyFor(requirementId) === undefined) {
      issues.push(
        issue(caseId, 'hard-failure-structure', `${requirementId} has no semantic key mapping`),
      );
    }
  }

  return issues;
}

/** Cross-case composition: totals, split sizes, and per-split gold balance. */
export function validateHardComposition(cases: readonly BenchmarkCase[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const present = new Set(cases.map((entry) => entry.caseId));
  for (const caseId of hardApprovedCaseIds()) {
    if (!present.has(caseId)) {
      issues.push(issue(caseId, 'approved-case', 'approved hard case is missing from the dataset'));
    }
  }

  const count = (split: 'development' | 'locked', verdict?: 'PASS' | 'FAIL'): number =>
    cases.filter(
      (entry) =>
        entry.metadata.split === split &&
        (verdict === undefined || entry.goldVerdict.overall === verdict),
    ).length;

  const expectations: Array<[string, number, number]> = [
    ['total cases', cases.length, HARD_APPROVED_TOTALS.cases],
    ['development split size', count('development'), HARD_APPROVED_TOTALS.development],
    ['locked split size', count('locked'), HARD_APPROVED_TOTALS.locked],
    [
      'gold PASS count',
      cases.filter((entry) => entry.goldVerdict.overall === 'PASS').length,
      HARD_APPROVED_TOTALS.goldPass,
    ],
    [
      'gold FAIL count',
      cases.filter((entry) => entry.goldVerdict.overall === 'FAIL').length,
      HARD_APPROVED_TOTALS.goldFail,
    ],
    ['development PASS', count('development', 'PASS'), HARD_APPROVED_TOTALS.developmentPass],
    ['development FAIL', count('development', 'FAIL'), HARD_APPROVED_TOTALS.developmentFail],
    ['locked PASS', count('locked', 'PASS'), HARD_APPROVED_TOTALS.lockedPass],
    ['locked FAIL', count('locked', 'FAIL'), HARD_APPROVED_TOTALS.lockedFail],
  ];
  for (const [label, actual, expected] of expectations) {
    if (actual !== expected) {
      issues.push(issue('<hard-benchmark>', 'hard-composition', `${label} is ${actual}, expected ${expected}`));
    }
  }

  // Split manifests must agree with metadata, and must not overlap.
  const development = new Set(caseIdsForSplit('development', HARD_SPLITS_DIR));
  const locked = new Set(caseIdsForSplit('locked', HARD_SPLITS_DIR));
  for (const benchmarkCase of cases) {
    const inDevelopment = development.has(benchmarkCase.caseId);
    const inLocked = locked.has(benchmarkCase.caseId);
    if (inDevelopment && inLocked) {
      issues.push(issue(benchmarkCase.caseId, 'hard-composition', 'case appears in both split manifests'));
    }
    if (!inDevelopment && !inLocked) {
      issues.push(issue(benchmarkCase.caseId, 'hard-composition', 'case appears in no split manifest'));
    }
    const declared = benchmarkCase.metadata.split;
    if ((declared === 'development') !== inDevelopment) {
      issues.push(
        issue(
          benchmarkCase.caseId,
          'hard-composition',
          `metadata declares split "${declared}" but the manifests disagree`,
        ),
      );
    }
  }

  return issues;
}

export function validateHardBenchmark(
  casesDir: string = HARD_CASES_DIR,
): BenchmarkValidationReport {
  const cases = loadAllCases(casesDir);
  const caseReports = cases.map((benchmarkCase) =>
    validateCase(benchmarkCase, casesDir, hardApprovedCase),
  );

  const issues: ValidationIssue[] = [
    ...validateHardComposition(cases),
    ...validateContractConsistency(cases),
  ];

  const withStructure = caseReports.map((report, index) => {
    const benchmarkCase = cases[index];
    if (benchmarkCase === undefined) return report;
    return {
      ...report,
      issues: [...report.issues, ...validateFailureStructure(benchmarkCase, report)],
    };
  });

  const ok =
    issues.every((item) => item.severity !== 'error') &&
    withStructure.every((report) => report.issues.every((item) => item.severity !== 'error'));

  return { caseReports: withStructure, issues, datasetHash: datasetHash(cases), ok };
}
