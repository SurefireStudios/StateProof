import { describe, expect, it } from 'vitest';
import {
  type ContractRequirement,
  type EvaluationContext,
  type RequirementVerdict,
  type TaskContract,
  rollUpVerdict,
  verifyContract,
} from '@stateproof/core';
import { approvalEvent, snapshot, toolCallEvent } from './fixtures';

function verdict(
  requirementId: string,
  status: RequirementVerdict['status'],
  mustPass: boolean,
): RequirementVerdict {
  return {
    requirementId,
    status,
    mustPass,
    severity: 'high',
    assertionOutcome: null,
    rationale: 'test',
    evidenceIds: [],
  };
}

describe('rollUpVerdict', () => {
  it('passes when every must-pass requirement is verified', () => {
    expect(
      rollUpVerdict([verdict('REQ-001-A', 'verified', true), verdict('REQ-002-B', 'verified', true)]),
    ).toBe('PASS');
  });

  it('fails as soon as one must-pass requirement is disproven', () => {
    expect(
      rollUpVerdict([verdict('REQ-001-A', 'verified', true), verdict('REQ-002-B', 'disproven', true)]),
    ).toBe('FAIL');
  });

  it('never turns missing evidence into a pass', () => {
    expect(
      rollUpVerdict([
        verdict('REQ-001-A', 'verified', true),
        verdict('REQ-002-B', 'insufficient_evidence', true),
      ]),
    ).toBe('NEEDS_REVIEW');
  });

  it('prefers FAIL over NEEDS_REVIEW when both apply', () => {
    expect(
      rollUpVerdict([
        verdict('REQ-001-A', 'disproven', true),
        verdict('REQ-002-B', 'insufficient_evidence', true),
      ]),
    ).toBe('FAIL');
  });

  it('lets advisory requirements pass without evidence', () => {
    expect(
      rollUpVerdict([
        verdict('REQ-001-A', 'verified', true),
        verdict('REQ-002-B', 'insufficient_evidence', false),
      ]),
    ).toBe('PASS');
  });
});

const requirement = (overrides: Partial<ContractRequirement>): ContractRequirement => ({
  requirementId: 'A-PROC-01',
  category: 'process',
  description: 'example',
  assertions: [],
  evidence: { sources: ['trajectory'], strategy: 'read the trace' },
  severity: 'critical',
  mustPass: true,
  ambiguities: [],
  ...overrides,
});

function contractOf(requirements: ContractRequirement[]): TaskContract {
  return {
    schemaVersion: '1.0.0',
    contractId: 'CONTRACT-TEST',
    taskId: 'TASK-TEST',
    compiledBy: 'human',
    compiledAt: '2025-03-04T09:00:00.000Z',
    requirements,
    notes: [],
  };
}

const context: EvaluationContext = {
  initialState: snapshot('initial', { orders: [{ id: 'ORD-1042', fields: { status: 'delivered' } }] }),
  finalState: snapshot('final', { orders: [{ id: 'ORD-1042', fields: { status: 'refunded' } }] }),
  trajectory: [
    toolCallEvent(1, 'refund.execute', { orderId: 'ORD-1042' }),
    approvalEvent(2, 'refund:ORD-1042'),
  ],
  finalResponse: 'done',
};

describe('verifyContract', () => {
  const contract = contractOf([
    requirement({
      requirementId: 'A-OUT-01',
      category: 'outcome',
      assertions: [
        {
          kind: 'record_field_equals',
          state: 'final',
          selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-1042' }] },
          field: 'status',
          expected: 'refunded',
        },
      ],
    }),
    requirement({
      requirementId: 'A-PROC-01',
      assertions: [
        {
          kind: 'event_order',
          earlier: { eventType: 'human_approval', scope: 'refund:ORD-1042' },
          later: { eventType: 'tool_call', toolName: 'refund.execute' },
        },
      ],
    }),
    requirement({
      requirementId: 'A-QUAL-01',
      category: 'quality',
      mustPass: false,
      severity: 'low',
    }),
  ]);

  it('treats a requirement as a conjunction of its assertions', () => {
    const conjunction = contractOf([
      requirement({
        requirementId: 'A-OUT-02',
        category: 'outcome',
        assertions: [
          {
            kind: 'record_field_equals',
            state: 'final',
            selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-1042' }] },
            field: 'status',
            expected: 'refunded',
          },
          {
            kind: 'record_exists',
            state: 'final',
            selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-9999' }] },
          },
        ],
      }),
    ]);
    const result = verifyContract(conjunction, context, 'PB-A03');
    expect(result.requirementVerdicts[0]?.status).toBe('disproven');
    expect(result.requirementVerdicts[0]?.evidenceIds).toHaveLength(2);
  });

  it('fails the run on the disproven process requirement while verifying the outcome', () => {
    const result = verifyContract(contract, context, 'PB-A03');
    expect(result.overall).toBe('FAIL');
    expect(result.requirementVerdicts.map((item) => item.status)).toEqual([
      'verified',
      'disproven',
      'insufficient_evidence',
    ]);
  });

  it('attaches evidence to every machine-checked requirement', () => {
    const result = verifyContract(contract, context, 'PB-A03');
    const evidenceIds = new Set(result.evidence.map((record) => record.evidenceId));
    for (const item of result.requirementVerdicts) {
      for (const evidenceId of item.evidenceIds) expect(evidenceIds.has(evidenceId)).toBe(true);
    }
    expect(result.evidence.every((record) => record.collectedBy === 'deterministic_verifier')).toBe(true);
  });

  it('produces identical output on repeated runs', () => {
    expect(JSON.stringify(verifyContract(contract, context, 'PB-A03'))).toBe(
      JSON.stringify(verifyContract(contract, context, 'PB-A03')),
    );
  });
});
