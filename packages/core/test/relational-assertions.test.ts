import { describe, expect, it } from 'vitest';
import {
  type Assertion,
  type JsonValue,
  type EvaluationContext,
  EventSelectorSchema,
  type StateSnapshot,
  evaluateAssertion,
} from '@stateproof/core';

function snapshot(label: 'initial' | 'final', collections: StateSnapshot['collections']): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: `SNAP-${label}`,
    label,
    capturedAt: '2025-03-04T09:00:00.000Z',
    collections,
  };
}

function contextWith(collections: StateSnapshot['collections']): EvaluationContext {
  return {
    initialState: snapshot('initial', { refunds: [], emails: [], support_cases: [] }),
    finalState: snapshot('final', collections),
    trajectory: [],
    finalResponse: 'done',
  };
}

const linkage: Assertion = {
  kind: 'record_field_equals_selected_record_id',
  leftState: 'final',
  leftSelector: { collection: 'emails', where: [{ field: 'relatedOrderId', equals: 'ORD-1' }] },
  leftField: 'refundId',
  rightState: 'final',
  rightSelector: {
    collection: 'refunds',
    where: [
      { field: 'orderId', equals: 'ORD-1' },
      { field: 'status', equals: 'succeeded' },
    ],
  },
};

const refund = (id: string, orderId = 'ORD-1', status = 'succeeded') => ({
  id,
  fields: { orderId, status },
});
const email = (id: string, refundId: string | null, relatedOrderId = 'ORD-1') => ({
  id,
  fields: { relatedOrderId, refundId },
});

describe('record_field_equals_selected_record_id', () => {
  it('is satisfied when the receipt references the completed refund', () => {
    const context = contextWith({ refunds: [refund('REF-1')], emails: [email('MSG-1', 'REF-1')] });
    const result = evaluateAssertion(linkage, context);
    expect(result.outcome).toBe('satisfied');
    expect(result.message).toContain('REF-1');
  });

  it('is violated when the receipt references a different refund', () => {
    const context = contextWith({
      refunds: [refund('REF-1')],
      emails: [email('MSG-1', 'REF-OTHER')],
    });
    expect(evaluateAssertion(linkage, context).outcome).toBe('violated');
  });

  it('is violated when the reference field is null', () => {
    const context = contextWith({ refunds: [refund('REF-1')], emails: [email('MSG-1', null)] });
    const result = evaluateAssertion(linkage, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('absent');
  });

  it('is violated when the referenced record does not exist', () => {
    const context = contextWith({ refunds: [], emails: [email('MSG-1', 'REF-1')] });
    expect(evaluateAssertion(linkage, context).outcome).toBe('violated');
  });

  it('is violated when the referencing record does not exist', () => {
    const context = contextWith({ refunds: [refund('REF-1')], emails: [] });
    expect(evaluateAssertion(linkage, context).outcome).toBe('violated');
  });

  it('is indeterminate when either selector is ambiguous', () => {
    const ambiguousRight = contextWith({
      refunds: [refund('REF-1'), refund('REF-2')],
      emails: [email('MSG-1', 'REF-1')],
    });
    expect(evaluateAssertion(linkage, ambiguousRight).outcome).toBe('indeterminate');

    const ambiguousLeft = contextWith({
      refunds: [refund('REF-1')],
      emails: [email('MSG-1', 'REF-1'), email('MSG-2', 'REF-1')],
    });
    expect(evaluateAssertion(linkage, ambiguousLeft).outcome).toBe('indeterminate');
  });

  it('is indeterminate when a collection is missing entirely', () => {
    const context = contextWith({ emails: [email('MSG-1', 'REF-1')] });
    expect(evaluateAssertion(linkage, context).outcome).toBe('indeterminate');
  });
});

const noteAssertion: Assertion = {
  kind: 'record_array_contains_exact',
  state: 'final',
  selector: { collection: 'support_cases', where: [{ field: 'id', equals: 'SUP-1' }] },
  field: 'notes',
  element: [{ field: 'text', equals: 'Partial refund approved for damaged item' }],
};

const supportCase = (id: string, notes: JsonValue) => ({ id, fields: { notes } });

describe('record_array_contains_exact', () => {
  it('is satisfied on an exact match', () => {
    const context = contextWith({
      support_cases: [
        supportCase('SUP-1', [{ noteId: 'N-1', text: 'Partial refund approved for damaged item' }]),
      ],
    });
    expect(evaluateAssertion(noteAssertion, context).outcome).toBe('satisfied');
  });

  it('does not fold case or accept a near miss', () => {
    for (const text of [
      'partial refund approved for damaged item',
      'Partial refund approved for damaged item.',
      'Partial refund approved for damaged goods',
      ' Partial refund approved for damaged item ',
    ]) {
      const context = contextWith({ support_cases: [supportCase('SUP-1', [{ text }])] });
      expect(evaluateAssertion(noteAssertion, context).outcome).toBe('violated');
    }
  });

  it('is violated when the notes array is empty', () => {
    const context = contextWith({ support_cases: [supportCase('SUP-1', [])] });
    expect(evaluateAssertion(noteAssertion, context).outcome).toBe('violated');
  });

  it('is violated when the field is not an array', () => {
    const context = contextWith({ support_cases: [supportCase('SUP-1', 'not-an-array')] });
    const result = evaluateAssertion(noteAssertion, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('no array field');
  });

  it('is violated when the record does not exist but the collection does', () => {
    const context = contextWith({ support_cases: [supportCase('SUP-OTHER', [])] });
    expect(evaluateAssertion(noteAssertion, context).outcome).toBe('violated');
  });

  it('is indeterminate when the record selector is ambiguous', () => {
    const context = contextWith({
      support_cases: [
        { id: 'SUP-1', fields: { orderId: 'ORD-1', notes: [] } },
        { id: 'SUP-2', fields: { orderId: 'ORD-1', notes: [] } },
      ],
    });
    const byOrder: Assertion = {
      ...noteAssertion,
      selector: { collection: 'support_cases', where: [{ field: 'orderId', equals: 'ORD-1' }] },
    };
    expect(evaluateAssertion(byOrder, context).outcome).toBe('indeterminate');
  });

  it('is indeterminate when the collection is missing', () => {
    expect(evaluateAssertion(noteAssertion, contextWith({ emails: [] })).outcome).toBe(
      'indeterminate',
    );
  });
});

describe('EventSelectorSchema field combinations', () => {
  it('accepts fields on the event type that carries them', () => {
    expect(
      EventSelectorSchema.safeParse({ eventType: 'tool_call', toolName: 'refund.execute' }).success,
    ).toBe(true);
    expect(
      EventSelectorSchema.safeParse({ eventType: 'tool_result', status: 'ok' }).success,
    ).toBe(true);
    expect(
      EventSelectorSchema.safeParse({
        eventType: 'human_approval',
        scope: 'refund:ORD-1',
        decision: 'approved',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['status on a tool_call', { eventType: 'tool_call', status: 'ok' }],
    ['scope on an agent_message', { eventType: 'agent_message', scope: 'refund:ORD-1' }],
    ['decision on a tool_result', { eventType: 'tool_result', decision: 'approved' }],
    ['toolName on a human_approval', { eventType: 'human_approval', toolName: 'refund.execute' }],
    [
      'argumentMatches on a tool_result',
      { eventType: 'tool_result', argumentMatches: [{ field: 'orderId', equals: 'ORD-1' }] },
    ],
  ])('rejects %s', (_label, selector) => {
    expect(EventSelectorSchema.safeParse(selector).success).toBe(false);
  });
});
