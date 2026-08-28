import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type Assertion,
  type EvaluationContext,
  type StateSnapshot,
  evaluateAssertion,
} from '@stateproof/core';
import { CASES_DIR } from '@stateproof/benchmark';
import { loadAllCases, loadBenchmarkCase } from '@stateproof/benchmark/gold';
import { validateCase, validateContractConsistency } from '@stateproof/benchmark/validate';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function fixtureCopy(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stateproof-contract-'));
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

describe('B1 — every Template A case uses the relational refund reference', () => {
  it.each(['PB-A01', 'PB-A02', 'PB-A03', 'PB-A04'])(
    '%s expresses A-OUT-02 without a hardcoded refund id',
    (caseId) => {
      const requirement = loadBenchmarkCase(caseId).goldContract.requirements.find(
        (entry) => entry.requirementId === 'A-OUT-02',
      );
      expect(requirement?.assertions.map((assertion) => assertion.kind)).toEqual([
        'record_field_equals',
        'record_field_equals',
        'record_field_equals_selected_record_id',
      ]);

      const serialized = JSON.stringify(requirement);
      expect(serialized).not.toContain('REF-88');
      expect(serialized).not.toContain('MSG-55');
    },
  );

  it('still resolves the reference for the frozen PB-A03 fixture', () => {
    const report = validateCase(loadBenchmarkCase('PB-A03'));
    const outcome = report.computedVerdict.requirementVerdicts.find(
      (verdict) => verdict.requirementId === 'A-OUT-02',
    );
    expect(outcome?.status).toBe('verified');
    expect(outcome?.rationale).toContain('expected the id of REF-8801');
  });
});

describe('B4 — contract consistency across a template', () => {
  it('accepts the shipped fixtures', () => {
    expect(validateContractConsistency(loadAllCases())).toEqual([]);
  });

  it('catches a one-off drift like the original PB-A03 hardcoded reference', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-A03', 'gold-contract.json'), (value) => {
      const requirements = value['requirements'] as Array<Record<string, unknown>>;
      const target = requirements.find((entry) => entry['requirementId'] === 'A-OUT-02');
      if (target === undefined) throw new Error('A-OUT-02 not found');
      const assertions = target['assertions'] as Array<Record<string, unknown>>;
      assertions[2] = {
        kind: 'record_field_equals',
        state: 'final',
        selector: {
          collection: 'emails',
          where: [{ field: 'relatedOrderId', equals: 'ORD-1042' }],
        },
        field: 'refundId',
        expected: 'REF-8801',
      };
    });

    const issues = validateContractConsistency(
      ['PB-A01', 'PB-A03'].map((caseId) => loadBenchmarkCase(caseId, casesDir)),
    );
    expect(issues.map((issue) => issue.check)).toContain('contract-consistency');
    expect(issues[0]?.message).toContain('A-OUT-02');
  });

  it('catches a requirement that a template case is missing entirely', () => {
    const casesDir = fixtureCopy();
    patchJson(path.join(casesDir, 'PB-C03', 'gold-contract.json'), (value) => {
      const requirements = value['requirements'] as Array<Record<string, unknown>>;
      value['requirements'] = requirements.filter(
        (entry) => entry['requirementId'] !== 'C-SCOPE-01',
      );
    });
    const issues = validateContractConsistency(
      ['PB-C01', 'PB-C03'].map((caseId) => loadBenchmarkCase(caseId, casesDir)),
    );
    expect(issues.map((issue) => issue.message).join(' ')).toContain('C-SCOPE-01');
  });
});

// --- B2 / B3 regression fixtures --------------------------------------------

function snapshot(collections: StateSnapshot['collections']): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: 'SNAP-TEST',
    label: 'final',
    capturedAt: '2025-03-04T09:00:00.000Z',
    collections,
  };
}

function contextWith(collections: StateSnapshot['collections']): EvaluationContext {
  return {
    initialState: snapshot({ emails: [], support_cases: [] }),
    finalState: snapshot(collections),
    trajectory: [],
    finalResponse: 'done',
  };
}

const NOTE_TEXT = 'Duplicate request denied; prior refund RF-8801 confirmed';

const noteRequirement = loadBenchmarkCase('PB-C01').goldContract.requirements.find(
  (entry) => entry.requirementId === 'C-OUT-02',
);
const noticeRequirement = loadBenchmarkCase('PB-C01').goldContract.requirements.find(
  (entry) => entry.requirementId === 'C-OUT-01',
);

function evaluateAll(assertions: readonly Assertion[], context: EvaluationContext): string[] {
  return assertions.map((assertion) => evaluateAssertion(assertion, context).outcome);
}

describe('B2 — the exact note fields must occur on one note', () => {
  it('is expressed as a single assertion', () => {
    expect(noteRequirement?.assertions).toHaveLength(1);
    expect(noteRequirement?.assertions[0]?.kind).toBe('record_array_contains_exact');
  });

  it('is satisfied when one note carries both fields', () => {
    const context = contextWith({
      support_cases: [
        {
          id: 'SUP-3091',
          fields: {
            notes: [{ noteId: 'N-1', text: NOTE_TEXT, relatedRefundId: 'RF-8801' }],
          },
        },
      ],
    });
    expect(evaluateAll(noteRequirement?.assertions ?? [], context)).toEqual(['satisfied']);
  });

  it('is violated when two decoy notes split the fields between them', () => {
    const context = contextWith({
      support_cases: [
        {
          id: 'SUP-3091',
          fields: {
            notes: [
              // Right text, wrong refund reference.
              { noteId: 'N-1', text: NOTE_TEXT, relatedRefundId: 'RF-9999' },
              // Right refund reference, wrong text.
              { noteId: 'N-2', text: 'Customer called about the refund', relatedRefundId: 'RF-8801' },
            ],
          },
        },
      ],
    });
    expect(evaluateAll(noteRequirement?.assertions ?? [], context)).toEqual(['violated']);
  });
});

describe('B3 — the notice must be the duplicate-refund notice', () => {
  const notice = {
    id: 'MSG-8001',
    fields: {
      to: 'lee@example.com',
      relatedOrderId: 'ORD-3091',
      refundId: 'RF-8801',
      status: 'sent',
    },
  };
  const unrelated = {
    id: 'MSG-9999',
    fields: {
      to: 'lee@example.com',
      relatedOrderId: 'ORD-3091',
      refundId: null,
      status: 'sent',
    },
  };

  it('is satisfied by the real notice', () => {
    const outcomes = evaluateAll(noticeRequirement?.assertions ?? [], contextWith({ emails: [notice] }));
    expect(outcomes.every((outcome) => outcome === 'satisfied')).toBe(true);
  });

  it('is not satisfied by an unrelated sent email to the same customer and order', () => {
    const outcomes = evaluateAll(
      noticeRequirement?.assertions ?? [],
      contextWith({ emails: [unrelated] }),
    );
    expect(outcomes).toContain('violated');
    expect(outcomes.every((outcome) => outcome === 'satisfied')).toBe(false);
  });

  it('still identifies the notice when an unrelated email sits alongside it', () => {
    const outcomes = evaluateAll(
      noticeRequirement?.assertions ?? [],
      contextWith({ emails: [unrelated, notice] }),
    );
    expect(outcomes.every((outcome) => outcome === 'satisfied')).toBe(true);
  });
});
