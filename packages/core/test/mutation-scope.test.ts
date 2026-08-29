import { describe, expect, it } from 'vitest';
import {
  ASSERTION_SCHEMA_VERSION,
  type Assertion,
  AssertionSchema,
  type CompiledContractV2,
  CompiledContractV2Schema,
  type EvaluationContext,
  type StateRecord,
  type StateSnapshot,
  assertionEvidenceRefs,
  evaluateAssertion,
  validateContractSemantics,
} from '@stateproof/core';

/**
 * `mutations_limited_to` exists because of a specific, documented failure: a
 * task says "do not modify unrelated orders or support cases" and never names
 * the support case, so the clause could not be written down at all. These tests
 * pin the behaviour that closes that gap — including the case where the
 * permitted record cannot be identified, which must withhold a verdict rather
 * than guess one.
 */

function snapshot(label: 'initial' | 'final', collections: StateSnapshot['collections']): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: `SNAP-${label}`,
    label,
    capturedAt: '2025-03-04T09:00:00.000Z',
    collections,
  };
}

const supportCase = (id: string, orderId: string, notes: string[] = []): StateRecord => ({
  id,
  fields: { orderId, notes },
});

function contextWith(
  initial: StateSnapshot['collections'],
  final: StateSnapshot['collections'],
): EvaluationContext {
  return {
    initialState: snapshot('initial', initial),
    finalState: snapshot('final', final),
    trajectory: [],
    finalResponse: 'done',
  };
}

/** Only the support case belonging to ORD-2077 may change. */
const relationalScope: Assertion = {
  kind: 'mutations_limited_to',
  collection: 'support_cases',
  allowedRecords: [
    {
      kind: 'selected_record',
      state: 'initial',
      selector: { collection: 'support_cases', where: [{ field: 'orderId', equals: 'ORD-2077' }] },
    },
  ],
};

const literalScope: Assertion = {
  kind: 'mutations_limited_to',
  collection: 'orders',
  allowedRecords: [{ kind: 'literal_id', id: 'ORD-2077' }],
};

describe('assertion schema v2', () => {
  it('is version 2.0.0', () => {
    expect(ASSERTION_SCHEMA_VERSION).toBe('2.0.0');
  });

  it('defaults a selected allowed record to the initial state', () => {
    const parsed = AssertionSchema.parse({
      kind: 'mutations_limited_to',
      collection: 'support_cases',
      allowedRecords: [
        {
          kind: 'selected_record',
          selector: { collection: 'support_cases', where: [{ field: 'orderId', equals: 'ORD-1' }] },
        },
      ],
    });
    expect(parsed).toMatchObject({ allowedRecords: [{ state: 'initial' }] });
  });

  it('rejects an empty allow-list', () => {
    expect(
      AssertionSchema.safeParse({
        kind: 'mutations_limited_to',
        collection: 'support_cases',
        allowedRecords: [],
      }).success,
    ).toBe(false);
  });
});

describe('mutations_limited_to', () => {
  const initial = {
    support_cases: [supportCase('SUP-2077', 'ORD-2077'), supportCase('SUP-2080', 'ORD-9999')],
  };

  it('passes when only the relationally selected record changed', () => {
    const context = contextWith(initial, {
      support_cases: [
        supportCase('SUP-2077', 'ORD-2077', ['refund issued']),
        supportCase('SUP-2080', 'ORD-9999'),
      ],
    });
    const result = evaluateAssertion(relationalScope, context);
    expect(result.outcome).toBe('satisfied');
    expect(result.message).toContain('SUP-2077');
  });

  it('passes when only the literally named record changed', () => {
    const context = contextWith(
      { orders: [{ id: 'ORD-2077', fields: { status: 'open' } }] },
      { orders: [{ id: 'ORD-2077', fields: { status: 'refunded' } }] },
    );
    expect(evaluateAssertion(literalScope, context).outcome).toBe('satisfied');
  });

  it('passes when nothing changed at all', () => {
    expect(evaluateAssertion(relationalScope, contextWith(initial, initial)).outcome).toBe(
      'satisfied',
    );
  });

  it('fails on a mutation of an unrelated support case', () => {
    const context = contextWith(initial, {
      support_cases: [
        supportCase('SUP-2077', 'ORD-2077'),
        supportCase('SUP-2080', 'ORD-9999', ['note written to the wrong case']),
      ],
    });
    const result = evaluateAssertion(relationalScope, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('SUP-2080');
  });

  it('fails on an added record outside the allow-set', () => {
    const context = contextWith(initial, {
      support_cases: [...initial.support_cases, supportCase('SUP-3000', 'ORD-2077')],
    });
    expect(evaluateAssertion(relationalScope, context).outcome).toBe('violated');
  });

  it('fails on a removed record outside the allow-set', () => {
    const context = contextWith(initial, { support_cases: [supportCase('SUP-2077', 'ORD-2077')] });
    expect(evaluateAssertion(relationalScope, context).outcome).toBe('violated');
  });

  it('is indeterminate when the selector matches no record', () => {
    const empty = { support_cases: [supportCase('SUP-1', 'ORD-OTHER')] };
    const result = evaluateAssertion(relationalScope, contextWith(empty, empty));
    expect(result.outcome).toBe('indeterminate');
    expect(result.message).toContain('matched 0 records');
  });

  it('is indeterminate when the selector matches more than one record', () => {
    const ambiguous = {
      support_cases: [supportCase('SUP-A', 'ORD-2077'), supportCase('SUP-B', 'ORD-2077')],
    };
    const result = evaluateAssertion(relationalScope, contextWith(ambiguous, ambiguous));
    expect(result.outcome).toBe('indeterminate');
    expect(result.message).toContain('matched 2 records');
  });

  it('is indeterminate when the collection is absent from a snapshot', () => {
    const result = evaluateAssertion(relationalScope, contextWith({}, {}));
    expect(result.outcome).toBe('indeterminate');
  });

  it('deduplicates a record named twice', () => {
    const both: Assertion = {
      kind: 'mutations_limited_to',
      collection: 'support_cases',
      allowedRecords: [
        { kind: 'literal_id', id: 'SUP-2077' },
        {
          kind: 'selected_record',
          state: 'initial',
          selector: {
            collection: 'support_cases',
            where: [{ field: 'orderId', equals: 'ORD-2077' }],
          },
        },
      ],
    };
    const context = contextWith(initial, {
      support_cases: [
        supportCase('SUP-2077', 'ORD-2077', ['changed']),
        supportCase('SUP-2080', 'ORD-9999'),
      ],
    });
    const result = evaluateAssertion(both, context);
    expect(result.outcome).toBe('satisfied');
    // "[SUP-2077]", not "[SUP-2077, SUP-2077]".
    expect(result.message).toContain('[SUP-2077]');
  });

  it('cites the diff, the permitted record and every offending record', () => {
    const context = contextWith(initial, {
      support_cases: [
        supportCase('SUP-2077', 'ORD-2077'),
        supportCase('SUP-2080', 'ORD-9999', ['wrong case']),
      ],
    });
    const refs = assertionEvidenceRefs(relationalScope, context);
    expect(refs).toContain('state_diff:support_cases');
    expect(refs.some((ref) => ref.includes('SUP-2077'))).toBe(true);
    expect(refs.some((ref) => ref.includes('SUP-2080'))).toBe(true);
  });
});

describe('contract v2 coverage fields', () => {
  const base = {
    contractVersion: '2' as const,
    taskSummary: 'Refund the order and message the customer.',
    ambiguities: [],
  };
  const requirement = {
    id: 'R-001',
    requirementKey: 'scope_integrity' as const,
    category: 'scope' as const,
    description: 'Only the target order and its support case changed.',
    severity: 'must_pass' as const,
    assertions: [literalScope],
  };

  it('accepts complete coverage with no limitations', () => {
    const parsed = CompiledContractV2Schema.safeParse({
      ...base,
      requirements: [{ ...requirement, verificationCoverage: 'complete', limitations: [] }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects complete coverage that also lists a limitation', () => {
    const parsed = CompiledContractV2Schema.safeParse({
      ...base,
      requirements: [
        { ...requirement, verificationCoverage: 'complete', limitations: ['support cases'] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects partial coverage that names no limitation', () => {
    const parsed = CompiledContractV2Schema.safeParse({
      ...base,
      requirements: [{ ...requirement, verificationCoverage: 'partial', limitations: [] }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('semantic contract validation', () => {
  const knownCollections = new Set(['orders', 'refunds', 'emails', 'support_cases']);
  const taskText = 'Refund ORD-2077 and do not modify unrelated orders or support cases.';

  function contractWith(assertions: Assertion[], overrides: Record<string, unknown> = {}) {
    return CompiledContractV2Schema.parse({
      contractVersion: '2',
      taskSummary: 'Scope check.',
      ambiguities: [],
      requirements: [
        {
          id: 'R-001',
          requirementKey: 'scope_integrity',
          category: 'scope',
          description: 'Only permitted records changed.',
          severity: 'must_pass',
          assertions,
          verificationCoverage: 'complete',
          limitations: [],
          ...overrides,
        },
      ],
    }) as CompiledContractV2;
  }

  it('accepts a contract that only names task literals', () => {
    const violations = validateContractSemantics(contractWith([relationalScope, literalScope]), {
      taskText,
      knownCollections,
    });
    expect(violations).toEqual([]);
  });

  it('rejects an id the task never states', () => {
    const violations = validateContractSemantics(
      contractWith([{ ...literalScope, allowedRecords: [{ kind: 'literal_id', id: 'ORD-9999' }] }]),
      { taskText, knownCollections },
    );
    expect(violations.map((violation) => violation.code)).toContain('ungrounded_literal');
  });

  it('rejects a selector reading from a different collection than it constrains', () => {
    const crossed: Assertion = {
      kind: 'mutations_limited_to',
      collection: 'support_cases',
      allowedRecords: [
        {
          kind: 'selected_record',
          state: 'initial',
          selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-2077' }] },
        },
      ],
    };
    const violations = validateContractSemantics(contractWith([crossed]), {
      taskText,
      knownCollections,
    });
    expect(violations.map((violation) => violation.code)).toContain('invalid_mutation_scope');
  });

  it('rejects an assertion over a collection the domain does not have', () => {
    const unknown: Assertion = {
      kind: 'no_unrelated_mutations',
      collection: 'invoices',
      allowedRecordIds: [],
    };
    const violations = validateContractSemantics(contractWith([unknown]), {
      taskText,
      knownCollections,
    });
    expect(violations.map((violation) => violation.code)).toContain('unknown_collection');
  });

  it('rejects contradictory coverage declarations', () => {
    // Built without the schema on purpose: Zod already refuses this shape, and
    // the semantic layer must refuse it too rather than trusting parse order.
    const contradictory: CompiledContractV2 = {
      contractVersion: '2',
      taskSummary: 'Scope check.',
      ambiguities: [],
      requirements: [
        {
          id: 'R-001',
          requirementKey: 'scope_integrity',
          category: 'scope',
          description: 'Only permitted records changed.',
          severity: 'must_pass',
          assertions: [literalScope],
          verificationCoverage: 'partial',
          limitations: [],
        },
      ],
    };
    const violations = validateContractSemantics(contradictory, { taskText, knownCollections });
    expect(violations.map((violation) => violation.code)).toContain(
      'coverage_partial_without_limitations',
    );
  });
});
