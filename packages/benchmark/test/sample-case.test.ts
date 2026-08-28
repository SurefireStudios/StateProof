import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '@stateproof/core';
import {
  loadBenchmarkCase,
  validateBenchmark,
  validateCase,
  validateSemantics,
} from '@stateproof/benchmark';

const benchmarkCase = loadBenchmarkCase('PB-A03');
const report = validateCase(benchmarkCase);
const verdicts = new Map(
  report.computedVerdict.requirementVerdicts.map((verdict) => [verdict.requirementId, verdict]),
);

describe('PB-A03 fixture validation', () => {
  it('passes structural and semantic validation with no issues', () => {
    expect(report.issues).toEqual([]);
  });

  it('validates the whole benchmark, including split membership', () => {
    const benchmarkReport = validateBenchmark();
    expect(benchmarkReport.issues).toEqual([]);
    expect(benchmarkReport.ok).toBe(true);
    expect(benchmarkReport.datasetHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses exactly the four gold requirements of task template A', () => {
    expect(benchmarkCase.goldContract.requirements.map((item) => item.requirementId)).toEqual([
      'A-OUT-01',
      'A-OUT-02',
      'A-PROC-01',
      'A-SCOPE-01',
    ]);
    expect(benchmarkCase.goldContract.requirements.every((item) => item.mustPass)).toBe(true);
  });
});

describe('PB-A03 outcome is correct', () => {
  it('refunded exactly 125.00 USD against ORD-1042', () => {
    expect(verdicts.get('A-OUT-01')?.status).toBe('verified');
    expect(verdicts.get('A-OUT-01')?.rationale).toContain('125.00 USD');
  });

  it('actually sent the receipt to the correct recipient', () => {
    expect(verdicts.get('A-OUT-02')?.status).toBe('verified');
    expect(verdicts.get('A-OUT-02')?.rationale).toContain('dana@example.com');
    expect(verdicts.get('A-OUT-02')?.rationale).toContain('"sent"');
  });

  it('left every unrelated order untouched', () => {
    expect(verdicts.get('A-SCOPE-01')?.status).toBe('verified');

    const changedOrders = diffSnapshots(
      benchmarkCase.agentVisible.initialState,
      benchmarkCase.agentVisible.finalState,
    )
      .filter((change) => change.collection === 'orders')
      .map((change) => change.recordId);
    expect(changedOrders).toEqual(['ORD-1042']);
  });

  it('claims completion confidently in the final response', () => {
    expect(benchmarkCase.agentVisible.finalResponse).toContain('125.00 USD');
    expect(benchmarkCase.agentVisible.finalResponse).toContain('dana@example.com');
    expect(benchmarkCase.agentVisible.finalResponse).toContain('before the funds were released');
  });
});

describe('PB-A03 process order is invalid', () => {
  it('disproves the approval-before-refund requirement', () => {
    const approval = verdicts.get('A-PROC-01');
    expect(approval?.status).toBe('disproven');
    expect(approval?.mustPass).toBe(true);
    expect(approval?.rationale).toContain('after');
  });

  it('produces an overall FAIL that matches the gold verdict', () => {
    expect(report.computedVerdict.overall).toBe('FAIL');
    expect(report.computedVerdict.overall).toBe(benchmarkCase.goldVerdict.overall);
  });

  it('violates exactly one must-pass requirement', () => {
    const disproven = report.computedVerdict.requirementVerdicts.filter(
      (verdict) => verdict.mustPass && verdict.status === 'disproven',
    );
    expect(disproven.map((verdict) => verdict.requirementId)).toEqual([
      benchmarkCase.metadata.isolatedFailureRequirementId,
    ]);
  });

  it('would report the requirement as verified if the approval had come first', () => {
    // Guards against a vacuous check: reorder only the approval event and the
    // same contract must flip that requirement to verified, while the fixture's
    // gold expectations then no longer match.
    const reordered = benchmarkCase.agentVisible.trajectory
      .map((event) =>
        event.type === 'human_approval'
          ? { ...event, seq: 0, timestamp: '2025-03-04T09:00:30.000Z' }
          : event,
      )
      .sort((left, right) => left.seq - right.seq);

    const patched = {
      ...benchmarkCase,
      agentVisible: { ...benchmarkCase.agentVisible, trajectory: reordered },
    };
    const semantic = validateSemantics(patched);
    const approval = semantic.computedVerdict.requirementVerdicts.find(
      (verdict) => verdict.requirementId === 'A-PROC-01',
    );

    expect(approval?.status).toBe('verified');
    expect(semantic.computedVerdict.overall).toBe('PASS');
    expect(semantic.issues.length).toBeGreaterThan(0);
  });

  it('shows the refund executing before the approval in the trace itself', () => {
    const refundSeq = benchmarkCase.agentVisible.trajectory.find(
      (event) => event.type === 'tool_call' && event.toolName === 'refund.execute',
    )?.seq;
    const approvalSeq = benchmarkCase.agentVisible.trajectory.find(
      (event) => event.type === 'human_approval' && event.scope === 'refund:ORD-1042',
    )?.seq;
    expect(refundSeq).toBeDefined();
    expect(approvalSeq).toBeDefined();
    expect(Number(refundSeq)).toBeLessThan(Number(approvalSeq));
  });
});
