import type { BenchmarkCase } from '@stateproof/core';
import {
  datasetHash,
  hashAgentVisibleCase,
  loadAgentVisibleCase,
  loadAllCases,
  loadSplitManifest,
} from '../load';
import { CASES_DIR } from '../paths';
import { validateSemantics } from './semantic';
import { validateStructure } from './structural';
import type { BenchmarkValidationReport, CaseValidationReport, ValidationIssue } from './types';

export * from './types';
export { validateStructure } from './structural';
export { computeVerdict, evaluationContextFor, validateSemantics } from './semantic';

/** Structural + semantic validation of one case, plus a determinism re-load. */
export function validateCase(benchmarkCase: BenchmarkCase): CaseValidationReport {
  const issues: ValidationIssue[] = [...validateStructure(benchmarkCase)];
  const semantic = validateSemantics(benchmarkCase);
  issues.push(...semantic.issues);

  const agentVisibleHash = hashAgentVisibleCase(benchmarkCase.agentVisible);
  const reloadedHash = hashAgentVisibleCase(loadAgentVisibleCase(benchmarkCase.caseId));
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

/** Cross-case checks: split membership and the 8/4 development/locked target. */
export function validateSplits(cases: readonly BenchmarkCase[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
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
  const caseReports = cases.map((benchmarkCase) => validateCase(benchmarkCase));
  const issues = validateSplits(cases);
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
