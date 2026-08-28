import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CASES_DIR, caseIdsForSplit } from '@stateproof/benchmark';
import { loadAllCases, loadBenchmarkCase } from '@stateproof/benchmark/gold';
import {
  APPROVED_CASES,
  APPROVED_TOTALS,
  approvedCaseIds,
  validateBenchmark,
  validateCase,
} from '@stateproof/benchmark/validate';

const cases = loadAllCases();
const report = validateBenchmark();
const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway copy of the whole case tree, so mutations cannot leak. */
function fixtureCopy(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stateproof-cases-'));
  tempRoots.push(root);
  const casesDir = path.join(root, 'cases');
  cpSync(CASES_DIR, casesDir, { recursive: true });
  return casesDir;
}

function patchJson(filePath: string, mutate: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  mutate(value);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('PhantomBench-12 is complete and balanced', () => {
  it('contains exactly the twelve approved case ids and no others', () => {
    expect(cases.map((entry) => entry.caseId).sort()).toEqual(approvedCaseIds().sort());
    expect(cases).toHaveLength(APPROVED_TOTALS.cases);
  });

  it('splits 8 development / 4 locked', () => {
    expect(caseIdsForSplit('development')).toHaveLength(APPROVED_TOTALS.development);
    expect(caseIdsForSplit('locked')).toHaveLength(APPROVED_TOTALS.locked);
  });

  it('balances 6 gold PASS / 6 gold FAIL', () => {
    const passes = cases.filter((entry) => entry.goldVerdict.overall === 'PASS');
    const fails = cases.filter((entry) => entry.goldVerdict.overall === 'FAIL');
    expect(passes).toHaveLength(APPROVED_TOTALS.goldPass);
    expect(fails).toHaveLength(APPROVED_TOTALS.goldFail);
  });

  it('balances each split 4/4 and 2/2', () => {
    for (const [split, expected] of [
      ['development', 4],
      ['locked', 2],
    ] as const) {
      const inSplit = cases.filter((entry) => entry.metadata.split === split);
      expect(inSplit.filter((entry) => entry.goldVerdict.overall === 'PASS')).toHaveLength(expected);
      expect(inSplit.filter((entry) => entry.goldVerdict.overall === 'FAIL')).toHaveLength(expected);
    }
  });

  it('validates every case with no issues', () => {
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    for (const caseReport of report.caseReports) {
      expect({ caseId: caseReport.caseId, issues: caseReport.issues }).toEqual({
        caseId: caseReport.caseId,
        issues: [],
      });
    }
  });
});

describe('every case matches the canonical matrix', () => {
  it.each(APPROVED_CASES.map((entry) => [entry.caseId, entry] as const))(
    '%s has the approved split, verdict and isolated failure',
    (caseId, approved) => {
      const benchmarkCase = loadBenchmarkCase(caseId);
      expect(benchmarkCase.metadata.split).toBe(approved.split);
      expect(benchmarkCase.goldVerdict.overall).toBe(approved.goldVerdict);
      expect(benchmarkCase.metadata.isolatedFailureRequirementId).toBe(
        approved.isolatedFailureRequirementId,
      );
    },
  );

  it('fails exactly the named isolated requirement on every invalid case', () => {
    for (const approved of APPROVED_CASES.filter((entry) => entry.goldVerdict === 'FAIL')) {
      const caseReport = report.caseReports.find((entry) => entry.caseId === approved.caseId);
      const disproven = (caseReport?.computedVerdict.requirementVerdicts ?? []).filter(
        (verdict) => verdict.mustPass && verdict.status === 'disproven',
      );
      expect(disproven.map((verdict) => verdict.requirementId)).toEqual([
        approved.isolatedFailureRequirementId,
      ]);
    }
  });

  it('verifies every must-pass requirement on every valid case', () => {
    for (const approved of APPROVED_CASES.filter((entry) => entry.goldVerdict === 'PASS')) {
      const caseReport = report.caseReports.find((entry) => entry.caseId === approved.caseId);
      const notVerified = (caseReport?.computedVerdict.requirementVerdicts ?? []).filter(
        (verdict) => verdict.mustPass && verdict.status !== 'verified',
      );
      expect({ caseId: approved.caseId, notVerified: notVerified.map((v) => v.requirementId) }).toEqual({
        caseId: approved.caseId,
        notVerified: [],
      });
    }
  });

  it('marks every case approved for use and single-fault', () => {
    for (const benchmarkCase of cases) {
      expect(benchmarkCase.metadata.approvedForUse).toBe(true);
      expect(benchmarkCase.metadata.multiFault).toBe(false);
    }
  });

  it('leaves failure fields null on every valid case', () => {
    for (const benchmarkCase of cases.filter((entry) => entry.metadata.goldLabel === 'valid')) {
      expect(benchmarkCase.metadata.failureMode).toBeNull();
      expect(benchmarkCase.metadata.failureDescription).toBeNull();
      expect(benchmarkCase.metadata.isolatedFailureRequirementId).toBeNull();
    }
  });
});

describe('the validator rejects broken fixtures', () => {
  it('catches a final state that the trajectory does not produce', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-A01', 'final-state.json'), (value) => {
      const collections = value['collections'] as Record<string, Array<Record<string, unknown>>>;
      const orders = collections['orders'] ?? [];
      const unrelated = orders.find((record) => record['id'] === 'ORD-1043');
      if (unrelated !== undefined) {
        (unrelated['fields'] as Record<string, unknown>)['status'] = 'cancelled';
      }
    });
    const issues = validateCase(loadBenchmarkCase('PB-A01', casesDir), casesDir).issues;
    expect(issues.map((issue) => issue.check)).toContain('state-derivability');
  });

  it('catches a gold verdict that disagrees with the canonical matrix', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-A01', 'gold-verdict.json'), (value) => {
      value['overall'] = 'FAIL';
    });
    const issues = validateCase(loadBenchmarkCase('PB-A01', casesDir), casesDir).issues;
    expect(issues.map((issue) => issue.check)).toContain('approved-case');
  });

  it('catches a case that is no longer approved for use', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-B01', 'case-metadata.json'), (value) => {
      value['approvedForUse'] = false;
    });
    const issues = validateCase(loadBenchmarkCase('PB-B01', casesDir), casesDir).issues;
    expect(issues.map((issue) => issue.message).join(' ')).toContain('approvedForUse');
  });

  it('catches a dangling reference between records', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-B01', 'final-state.json'), (value) => {
      const collections = value['collections'] as Record<string, Array<Record<string, unknown>>>;
      const email = (collections['emails'] ?? [])[0];
      if (email !== undefined) {
        (email['fields'] as Record<string, unknown>)['refundId'] = 'REF-DOES-NOT-EXIST';
      }
    });
    const checks = validateCase(loadBenchmarkCase('PB-B01', casesDir), casesDir).issues.map(
      (issue) => issue.check,
    );
    expect(checks).toContain('referential-integrity');
  });

  it('catches a requirement whose computed status no longer matches gold', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-C01', 'gold-verdict.json'), (value) => {
      const expectations = value['requirementExpectations'] as Array<Record<string, unknown>>;
      const prohibition = expectations.find((entry) => entry['requirementId'] === 'C-PROH-01');
      if (prohibition !== undefined) prohibition['expectedStatus'] = 'disproven';
    });
    const checks = validateCase(loadBenchmarkCase('PB-C01', casesDir), casesDir).issues.map(
      (issue) => issue.check,
    );
    expect(checks).toContain('requirement-expectation');
  });

  it('uses the case directory it is given, not the default one', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-A01', 'task.json'), (value) => {
      value['taskId'] = 'TASK-SOMETHING-ELSE';
    });
    const patched = loadBenchmarkCase('PB-A01', casesDir);
    expect(patched.agentVisible.task.taskId).toBe('TASK-SOMETHING-ELSE');
    expect(loadBenchmarkCase('PB-A01').agentVisible.task.taskId).toBe('TASK-PB-A01');
  });
});
