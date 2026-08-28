import { describe, expect, it } from 'vitest';
import {
  type Assertion,
  type EvaluationContext,
  type StateRecord,
  type TraceEvent,
  evaluateAssertion,
} from '@stateproof/core';
import { approvalEvent, snapshot, toolCallEvent } from './fixtures';

const orders = (status: string): StateRecord[] => [
  {
    id: 'ORD-1042',
    fields: { status, total: { amount: '125.00', currency: 'USD' } },
  },
  { id: 'ORD-1043', fields: { status: 'processing' } },
];

function contextWith(
  trajectory: TraceEvent[],
  finalOrders: StateRecord[] = orders('refunded'),
): EvaluationContext {
  return {
    initialState: snapshot('initial', { orders: orders('delivered'), refunds: [] }),
    finalState: snapshot('final', { orders: finalOrders, refunds: [] }),
    trajectory,
    finalResponse: 'done',
  };
}

describe('event_order assertion', () => {
  const assertion: Assertion = {
    kind: 'event_order',
    earlier: { eventType: 'human_approval', scope: 'refund:ORD-1042', decision: 'approved' },
    later: {
      eventType: 'tool_call',
      toolName: 'refund.execute',
      argumentMatches: [{ field: 'orderId', equals: 'ORD-1042' }],
    },
  };

  it('is satisfied when the approval precedes the protected action', () => {
    const context = contextWith([
      approvalEvent(1, 'refund:ORD-1042'),
      toolCallEvent(2, 'refund.execute', { orderId: 'ORD-1042' }),
    ]);
    expect(evaluateAssertion(assertion, context).outcome).toBe('satisfied');
  });

  it('is violated when the approval arrives after the protected action', () => {
    const context = contextWith([
      toolCallEvent(1, 'refund.execute', { orderId: 'ORD-1042' }),
      approvalEvent(2, 'refund:ORD-1042'),
    ]);
    const result = evaluateAssertion(assertion, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('seq 2');
  });

  it('is violated when the approval never happens at all', () => {
    const context = contextWith([toolCallEvent(1, 'refund.execute', { orderId: 'ORD-1042' })]);
    expect(evaluateAssertion(assertion, context).outcome).toBe('violated');
  });

  it('ignores an approval scoped to a different action', () => {
    const context = contextWith([
      approvalEvent(1, 'refund:ORD-9999'),
      toolCallEvent(2, 'refund.execute', { orderId: 'ORD-1042' }),
    ]);
    expect(evaluateAssertion(assertion, context).outcome).toBe('violated');
  });

  it('is vacuously satisfied when the protected action never ran', () => {
    // Nothing can precede an action that never happened. The outcome
    // requirements are what should fail for a no-op agent.
    const context = contextWith([
      approvalEvent(1, 'refund:ORD-1042'),
      toolCallEvent(2, 'orders.get', { orderId: 'ORD-1042' }),
    ]);
    expect(evaluateAssertion(assertion, context).outcome).toBe('satisfied');
  });

  it('is indeterminate when neither event appears', () => {
    const context = contextWith([toolCallEvent(1, 'orders.list')]);
    const scopeless: Assertion = {
      kind: 'event_order',
      earlier: { eventType: 'human_approval', scope: 'refund:ORD-1042' },
      later: { eventType: 'tool_call', toolName: 'refund.execute' },
    };
    expect(evaluateAssertion(scopeless, context).outcome).toBe('indeterminate');
  });
});

describe('record assertions', () => {
  const context = contextWith([]);

  it('matches a field by record id', () => {
    const assertion: Assertion = {
      kind: 'record_field_equals',
      state: 'final',
      selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-1042' }] },
      field: 'status',
      expected: 'refunded',
    };
    expect(evaluateAssertion(assertion, context).outcome).toBe('satisfied');
  });

  it('is violated when the field holds a different value', () => {
    const assertion: Assertion = {
      kind: 'record_field_equals',
      state: 'initial',
      selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-1042' }] },
      field: 'status',
      expected: 'refunded',
    };
    expect(evaluateAssertion(assertion, context).outcome).toBe('violated');
  });

  it('compares money exactly, including currency', () => {
    const matching: Assertion = {
      kind: 'record_money_equals',
      state: 'final',
      selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-1042' }] },
      field: 'total',
      expected: { amount: '125.00', currency: 'USD' },
    };
    const wrongCurrency: Assertion = { ...matching, expected: { amount: '125.00', currency: 'EUR' } };
    expect(evaluateAssertion(matching, context).outcome).toBe('satisfied');
    expect(evaluateAssertion(wrongCurrency, context).outcome).toBe('violated');
  });

  it('reports an absent collection as indeterminate rather than as a pass', () => {
    const assertion: Assertion = {
      kind: 'record_exists',
      state: 'final',
      selector: { collection: 'invoices', where: [{ field: 'id', equals: 'INV-1' }] },
    };
    expect(evaluateAssertion(assertion, context).outcome).toBe('indeterminate');
  });

  it('reports an ambiguous selector as indeterminate rather than guessing', () => {
    const assertion: Assertion = {
      kind: 'record_field_equals',
      state: 'final',
      selector: {
        collection: 'orders',
        where: [{ field: 'customerEmail', equals: 'dana@example.com' }],
      },
      field: 'status',
      expected: 'refunded',
    };
    const ambiguous: EvaluationContext = {
      ...context,
      finalState: snapshot('final', {
        orders: [
          { id: 'ORD-1042', fields: { customerEmail: 'dana@example.com', status: 'refunded' } },
          { id: 'ORD-1050', fields: { customerEmail: 'dana@example.com', status: 'delivered' } },
        ],
      }),
    };
    expect(evaluateAssertion(assertion, ambiguous).outcome).toBe('indeterminate');
  });

  it('detects an absent record', () => {
    const assertion: Assertion = {
      kind: 'record_exists',
      state: 'final',
      selector: { collection: 'refunds', where: [{ field: 'orderId', equals: 'ORD-1042' }] },
    };
    expect(evaluateAssertion(assertion, context).outcome).toBe('violated');
  });
});

describe('scope assertions', () => {
  it('passes when only the permitted record changed', () => {
    const assertion: Assertion = {
      kind: 'no_unrelated_mutations',
      collection: 'orders',
      allowedRecordIds: ['ORD-1042'],
    };
    expect(evaluateAssertion(assertion, contextWith([])).outcome).toBe('satisfied');
  });

  it('fails when an unrelated record changed', () => {
    const assertion: Assertion = {
      kind: 'no_unrelated_mutations',
      collection: 'orders',
      allowedRecordIds: ['ORD-1042'],
    };
    const context = contextWith(
      [],
      [
        { id: 'ORD-1042', fields: { status: 'refunded', total: { amount: '125.00', currency: 'USD' } } },
        { id: 'ORD-1043', fields: { status: 'cancelled' } },
      ],
    );
    const result = evaluateAssertion(assertion, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('ORD-1043');
  });

  it('fails when a prohibited record is created', () => {
    const assertion: Assertion = {
      kind: 'no_new_records',
      collection: 'orders',
      allowedRecordIds: [],
    };
    const context = contextWith(
      [],
      [...orders('refunded'), { id: 'ORD-9001', fields: { status: 'processing' } }],
    );
    expect(evaluateAssertion(assertion, context).outcome).toBe('violated');
  });
});
