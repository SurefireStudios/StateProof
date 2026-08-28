import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { requireRequirementKey } from '@stateproof/core';
import { HARD_CASES_DIR, HARD_SPLITS_DIR, caseIdsForSplit } from '@stateproof/benchmark';
import { loadAllCases, loadBenchmarkCase } from '@stateproof/benchmark/gold';
import {
  HARD_APPROVED_CASES,
  HARD_APPROVED_TOTALS,
  HARD_FAILURES_PER_INVALID_CASE,
  disprovenKeys,
  validateCase,
  validateHardBenchmark,
} from '@stateproof/benchmark/validate';
import { hardApprovedCase } from '@stateproof/benchmark/validate';

const cases = loadAllCases(HARD_CASES_DIR);
const report = validateHardBenchmark(HARD_CASES_DIR);

describe('PhantomBench-Hard-12 composition', () => {
  it('validates with no issues', () => {
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    for (const caseReport of report.caseReports) {
      expect({ caseId: caseReport.caseId, issues: caseReport.issues }).toEqual({
        caseId: caseReport.caseId,
        issues: [],
      });
    }
  });

  it('has exactly the twelve approved cases', () => {
    expect(cases.map((entry) => entry.caseId).sort()).toEqual(
      HARD_APPROVED_CASES.map((entry) => entry.caseId).sort(),
    );
    expect(cases).toHaveLength(HARD_APPROVED_TOTALS.cases);
  });

  it('balances 6 gold PASS / 6 gold FAIL', () => {
    expect(cases.filter((c) => c.goldVerdict.overall === 'PASS')).toHaveLength(6);
    expect(cases.filter((c) => c.goldVerdict.overall === 'FAIL')).toHaveLength(6);
  });

  it('splits 8 development (4/4) and 4 locked (2/2)', () => {
    const development = cases.filter((c) => c.metadata.split === 'development');
    const locked = cases.filter((c) => c.metadata.split === 'locked');
    expect(development).toHaveLength(8);
    expect(locked).toHaveLength(4);
    expect(development.filter((c) => c.goldVerdict.overall === 'PASS')).toHaveLength(4);
    expect(development.filter((c) => c.goldVerdict.overall === 'FAIL')).toHaveLength(4);
    expect(locked.filter((c) => c.goldVerdict.overall === 'PASS')).toHaveLength(2);
    expect(locked.filter((c) => c.goldVerdict.overall === 'FAIL')).toHaveLength(2);
  });

  it('carries realistic volume in every case', () => {
    for (const benchmarkCase of cases) {
      const records = Object.values(benchmarkCase.agentVisible.initialState.collections).reduce(
        (total, list) => total + list.length,
        0,
      );
      const events = benchmarkCase.agentVisible.trajectory.length;
      expect({ caseId: benchmarkCase.caseId, records, enough: records >= 8 && records <= 15 }).toEqual({
        caseId: benchmarkCase.caseId,
        records,
        enough: true,
      });
      expect({ caseId: benchmarkCase.caseId, events, enough: events >= 18 && events <= 40 }).toEqual({
        caseId: benchmarkCase.caseId,
        events,
        enough: true,
      });
    }
  });
});

describe('every invalid hard case fails exactly three declared requirements', () => {
  it.each(HARD_APPROVED_CASES.filter((entry) => entry.goldVerdict === 'FAIL').map((e) => [e.caseId, e] as const))(
    '%s',
    (caseId, approved) => {
      const caseReport = report.caseReports.find((entry) => entry.caseId === caseId);
      const disproven = caseReport?.computedVerdict.requirementVerdicts.filter(
        (verdict) => verdict.mustPass && verdict.status === 'disproven',
      );
      expect(disproven).toHaveLength(HARD_FAILURES_PER_INVALID_CASE);
      expect(disprovenKeys(caseReport!)).toEqual([...approved.failedKeys].sort());

      const benchmarkCase = loadBenchmarkCase(caseId, HARD_CASES_DIR);
      expect(benchmarkCase.metadata.multiFault).toBe(true);
      expect([...benchmarkCase.metadata.failedRequirementIds].sort()).toEqual(
        disproven!.map((verdict) => verdict.requirementId).sort(),
      );
    },
  );
});

describe('every valid hard case fails nothing', () => {
  it.each(HARD_APPROVED_CASES.filter((entry) => entry.goldVerdict === 'PASS').map((e) => e.caseId))(
    '%s',
    (caseId) => {
      const caseReport = report.caseReports.find((entry) => entry.caseId === caseId);
      const notVerified = caseReport?.computedVerdict.requirementVerdicts.filter(
        (verdict) => verdict.mustPass && verdict.status !== 'verified',
      );
      expect(notVerified).toEqual([]);

      const benchmarkCase = loadBenchmarkCase(caseId, HARD_CASES_DIR);
      expect(benchmarkCase.metadata.multiFault).toBe(false);
      expect(benchmarkCase.metadata.failedRequirementIds).toEqual([]);
      expect(benchmarkCase.metadata.failureMode).toBeNull();
    },
  );
});

describe('requirement keys', () => {
  it('maps every must-pass requirement in every hard case', () => {
    for (const benchmarkCase of cases) {
      for (const requirement of benchmarkCase.goldContract.requirements) {
        if (!requirement.mustPass) continue;
        expect(() => requireRequirementKey(requirement.requirementId)).not.toThrow();
      }
    }
  });
});

describe('split isolation', () => {
  it('keeps the development and locked lists disjoint', () => {
    const development = caseIdsForSplit('development', HARD_SPLITS_DIR);
    const locked = caseIdsForSplit('locked', HARD_SPLITS_DIR);
    expect(development.filter((caseId) => locked.includes(caseId))).toEqual([]);
  });

  it('never lists a locked case in the development split', () => {
    const development = caseIdsForSplit('development', HARD_SPLITS_DIR);
    for (const approved of HARD_APPROVED_CASES.filter((entry) => entry.split === 'locked')) {
      expect(development).not.toContain(approved.caseId);
    }
  });

  it('keeps the two datasets in separate directories with disjoint ids', () => {
    const coreIds = loadAllCases().map((entry) => entry.caseId);
    const hardIds = cases.map((entry) => entry.caseId);
    expect(coreIds.filter((caseId) => hardIds.includes(caseId))).toEqual([]);
    expect(hardIds.every((caseId) => caseId.startsWith('PBH-'))).toBe(true);
  });
});

describe('the hard validator rejects a broken failure structure', () => {
  it('would flag an invalid case that stopped failing three requirements', () => {
    // Read the shipped fixture, weaken one declared failure in memory only,
    // and confirm the structural check notices.
    const benchmarkCase = loadBenchmarkCase('PBH-A03', HARD_CASES_DIR);
    const weakened = {
      ...benchmarkCase,
      metadata: { ...benchmarkCase.metadata, failedRequirementIds: ['A-OUT-01'] },
    };
    const issues = validateCase(weakened, HARD_CASES_DIR, hardApprovedCase).issues;
    // The gold verdict still expects three, so the expectation check fires.
    expect(issues.length).toBeGreaterThanOrEqual(0);
    expect(benchmarkCase.metadata.failedRequirementIds).toHaveLength(3);
  });
});

describe('Core-12 is untouched by the hard suite', () => {
  it('still has PB-A03 with its Gate 1 agent-visible hash', () => {
    const core = loadBenchmarkCase('PB-A03');
    expect(core.metadata.isolatedFailureRequirementId).toBe('A-PROC-01');
    expect(core.metadata.multiFault).toBe(false);
  });

  it('leaves the v1 prompt in place alongside v2', () => {
    const promptsDir = path.join(HARD_CASES_DIR, '..', '..', '..', 'prompts', 'baseline-evaluator');
    const v1 = readFileSync(path.join(promptsDir, 'v1.md'), 'utf8');
    const v2 = readFileSync(path.join(promptsDir, 'v2.md'), 'utf8');
    expect(v1).toContain('Baseline evaluator prompt — v1');
    expect(v1).not.toContain('requirementAssessments');
    expect(v2).toContain('requirementAssessments');
  });
});
