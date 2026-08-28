import type { BenchmarkCase } from '@stateproof/core';
import { APPROVED_TOTALS, type ApprovedCase, approvedCaseIds } from './approved-cases';
import { hashAgentVisibleCase, loadAgentVisibleCase } from '../load-agent-input';
import { datasetHash, loadAllCases, loadSplitManifest } from '../load-gold';
import { CASES_DIR } from '../paths';
import { validateContractConsistency } from './contract-consistency';
import { validateSemantics } from './semantic';
import { validateStructure } from './structural';
import type { BenchmarkValidationReport, CaseValidationReport, ValidationIssue } from './types';

export * from './types';
export * from './approved-cases';
export * from './hard-cases';
export * from './hard';
export { validateContractConsistency } from './contract-consistency';
export { validateStructure } from './structural';
export { computeVerdict, evaluationContextFor, validateSemantics } from './semantic';

/** Structural + semantic validation of one case, plus a determinism re-load. */
export function validateCase(
  benchmarkCase: BenchmarkCase,
  casesDir: string = CASES_DIR,
  lookupApproved?: (caseId: string) => ApprovedCase | undefined,
): CaseValidationReport {
  const issues: ValidationIssue[] = [...validateStructure(benchmarkCase, lookupApproved)];
  const semantic = validateSemantics(benchmarkCase);
  issues.push(...semantic.issues);

  const agentVisibleHash = hashAgentVisibleCase(benchmarkCase.agentVisible);
  const reloadedHash = hashAgentVisibleCase(loadAgentVisibleCase(benchmarkCase.caseId, { casesDir }));
  if (reloadedHash !== agentVisibleHash) {
    issues.push({
      caseId: benchmarkCase.caseId,
      check: 'determinism',
      severity: 'error',
      message: 'reloading the case produced a different agent-visible hash',
    });
  }

  return {
    caseId: benchmarkCase.caseId,
    issues,
    computedVerdict: semantic.computedVerdict,
    agentVisibleHash,
  };
}

/**
 * Cross-case checks: the approved case set is complete and exclusive, split
 * membership agrees with metadata, and the canonical 8/4 split and 6/6 gold
 * balance hold.
 */
export function validateSplits(cases: readonly BenchmarkCase[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const presentIds = new Set(cases.map((benchmarkCase) => benchmarkCase.caseId));
  for (const caseId of approvedCaseIds()) {
    if (!presentIds.has(caseId)) {
      issues.push({
        caseId,
        check: 'approved-case',
        severity: 'error',
        message: 'approved case is missing from benchmarks/phantombench-12/cases',
      });
    }
  }

  if (cases.length === APPROVED_TOTALS.cases) {
    const bySplit = (split: 'development' | 'locked'): number =>
      cases.filter((benchmarkCase) => benchmarkCase.metadata.split === split).length;
    const byGold = (verdict: 'PASS' | 'FAIL'): number =>
      cases.filter((benchmarkCase) => benchmarkCase.goldVerdict.overall === verdict).length;

    const expectations: Array<[string, number, number]> = [
      ['development split size', bySplit('development'), APPROVED_TOTALS.development],
      ['locked split size', bySplit('locked'), APPROVED_TOTALS.locked],
      ['gold PASS count', byGold('PASS'), APPROVED_TOTALS.goldPass],
      ['gold FAIL count', byGold('FAIL'), APPROVED_TOTALS.goldFail],
    ];
    for (const [label, actual, expected] of expectations) {
      if (actual !== expected) {
        issues.push({
          caseId: '<benchmark>',
          check: 'split-balance',
          severity: 'error',
          message: `${label} is ${actual}, expected ${expected}`,
        });
      }
    }
  } else {
    issues.push({
      caseId: '<benchmark>',
      check: 'split-balance',
      severity: 'error',
      message: `benchmark holds ${cases.length} case(s); the approved core set has ${APPROVED_TOTALS.cases}`,
    });
  }
  const development = loadSplitManifest('development');
  const locked = loadSplitManifest('locked');

  const membership = new Map<string, string[]>();
  for (const manifest of [development, locked]) {
    for (const caseId of manifest.caseIds) {
      membership.set(caseId, [...(membership.get(caseId) ?? []), manifest.split]);
    }
  }

  for (const benchmarkCase of cases) {
    const splits = membership.get(benchmarkCase.caseId) ?? [];
    if (splits.length === 0) {
      issues.push({
        caseId: benchmarkCase.caseId,
        check: 'split-membership',
        severity: 'error',
        message: 'case does not appear in any split manifest',
      });
      continue;
    }
    if (splits.length > 1) {
      issues.push({
        caseId: benchmarkCase.caseId,
        check: 'split-membership',
        severity: 'error',
        message: `case appears in multiple splits (${splits.join(', ')})`,
      });
    }
    if (!splits.includes(benchmarkCase.metadata.split)) {
      issues.push({
        caseId: benchmarkCase.caseId,
        check: 'split-membership',
        severity: 'error',
        message: `metadata declares split "${benchmarkCase.metadata.split}" but the manifests list it under ${splits.join(', ')}`,
      });
    }
  }

  const knownCaseIds = new Set(cases.map((benchmarkCase) => benchmarkCase.caseId));
  for (const manifest of [development, locked]) {
    for (const caseId of manifest.caseIds) {
      if (!knownCaseIds.has(caseId)) {
        issues.push({
          caseId,
          check: 'split-membership',
          severity: 'error',
          message: `splits/${manifest.split}.json lists ${caseId}, which has no case directory`,
        });
      }
    }
  }

  return issues;
}

export function validateBenchmark(casesDir: string = CASES_DIR): BenchmarkValidationReport {
  const cases = loadAllCases(casesDir);
  const caseReports = cases.map((benchmarkCase) => validateCase(benchmarkCase, casesDir));
  const issues = [...validateSplits(cases), ...validateContractConsistency(cases)];
  const ok =
    issues.every((item) => item.severity !== 'error') &&
    caseReports.every((report) => report.issues.every((item) => item.severity !== 'error'));

  return {
    caseReports,
    issues,
    datasetHash: datasetHash(cases),
    ok,
  };
}
