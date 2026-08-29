import { describe, expect, it } from 'vitest';
import {
  ASSERTION_SCHEMA_VERSION,
  type Assertion,
  AssertionSchema,
  type EvaluationContext,
  type StateRecord,
  type StateSnapshot,
  assertionEvidenceRefs,
  evaluateAssertion,
} from '@stateproof/core';

/**
 * `record_exists_matching` exists because of one measured failure: every
 * customer-message requirement was written as "select the message, then check
 * it", and every fixture holds an older message to the same recipient. Two
 * matches, no verdict.
 *
 * These tests pin the distinction that fixes it — *does a record satisfying
 * everything exist* rather than *what does the one matching record say* — and,
 * just as importantly, pin the cases where it must still say no.
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

function contextWith(collections: StateSnapshot['collections']): EvaluationContext {
  return {
    initialState: snapshot('initial', { emails: [], refunds: [] }),
    finalState: snapshot('final', collections),
    trajectory: [],
    finalResponse: 'done',
  };
}

const email = (
  id: string,
  fields: {
    to?: string;
    relatedOrderId?: string | null;
    refundId?: string | null;
    status?: string;
  },
): StateRecord => ({
  id,
  fields: {
    to: fields.to ?? 'maya@example.com',
    relatedOrderId: fields.relatedOrderId ?? 'ORD-2077',
    refundId: fields.refundId ?? null,
    status: fields.status ?? 'sent',
  },
});

const refund = (id: string, orderId = 'ORD-2077', status = 'succeeded'): StateRecord => ({
  id,
  fields: { orderId, status },
});

/** The receipt requirement, exactly as prompt v3 directs it to be written. */
const receipt: Assertion = {
  kind: 'record_exists_matching',
  state: 'final',
  collection: 'emails',
  where: [
    { field: 'to', equals: 'maya@example.com' },
    { field: 'relatedOrderId', equals: 'ORD-2077' },
    { field: 'status', equals: 'sent' },
    {
      field: 'refundId',
      equalsSelectedRecordId: {
        state: 'final',
        selector: {
          collection: 'refunds',
          where: [
            { field: 'orderId', equals: 'ORD-2077' },
            { field: 'status', equals: 'succeeded' },
          ],
        },
      },
    },
  ],
  minCount: 1,
};

describe('assertion schema v2.1', () => {
  it('is version 2.1.0', () => {
    expect(ASSERTION_SCHEMA_VERSION).toBe('2.1.0');
  });

  it('defaults minCount to 1 and rejects a non-positive one', () => {
    const parsed = AssertionSchema.parse({
      kind: 'record_exists_matching',
      state: 'final',
      collection: 'emails',
      where: [{ field: 'to', equals: 'maya@example.com' }],
    });
    expect(parsed).toMatchObject({ minCount: 1 });
    expect(
      AssertionSchema.safeParse({
        kind: 'record_exists_matching',
        state: 'final',
        collection: 'emails',
        where: [{ field: 'to', equals: 'maya@example.com' }],
        minCount: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects an empty condition list', () => {
    expect(
      AssertionSchema.safeParse({
        kind: 'record_exists_matching',
        state: 'final',
        collection: 'emails',
        where: [],
      }).success,
    ).toBe(false);
  });
});

describe('record_exists_matching', () => {
  it('passes on one correct record among distractors to the same recipient', () => {
    // MSG-OLD is the exact record that made the previous iteration indeterminate.
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [
        email('MSG-OLD', { relatedOrderId: 'ORD-1900', refundId: 'RFX-7001' }),
        email('MSG-NEW', { refundId: 'RFB-9201' }),
        email('MSG-OTHER', { to: 'someone@example.com', refundId: 'RFB-9201' }),
      ],
    });
    const result = evaluateAssertion(receipt, context);
    expect(result.outcome).toBe('satisfied');
    expect(result.message).toContain('MSG-NEW');
  });

  it('refuses to combine two records that each satisfy half of it', () => {
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [
        // Right recipient and order, but still a draft.
        email('MSG-DRAFT', { refundId: 'RFB-9201', status: 'draft' }),
        // Sent, but references the wrong refund.
        email('MSG-SENT', { refundId: 'RFX-7001' }),
      ],
    });
    const result = evaluateAssertion(receipt, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('no single record satisfies all of them');
  });

  it('fails on the wrong recipient', () => {
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [email('MSG-1', { to: 'wrong@example.com', refundId: 'RFB-9201' })],
    });
    expect(evaluateAssertion(receipt, context).outcome).toBe('violated');
  });

  it('fails on a draft rather than a sent message', () => {
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [email('MSG-1', { refundId: 'RFB-9201', status: 'draft' })],
    });
    const result = evaluateAssertion(receipt, context);
    expect(result.outcome).toBe('violated');
    expect(result.message).toContain('status="sent"');
  });

  it('fails on the wrong related order', () => {
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [email('MSG-1', { relatedOrderId: 'ORD-9999', refundId: 'RFB-9201' })],
    });
    expect(evaluateAssertion(receipt, context).outcome).toBe('violated');
  });

  it('fails on the wrong refund relationship', () => {
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [email('MSG-1', { refundId: 'RFX-7001' })],
    });
    expect(evaluateAssertion(receipt, context).outcome).toBe('violated');
  });

  it('fails when no message exists at all', () => {
    const context = contextWith({ refunds: [refund('RFB-9201')], emails: [] });
    expect(evaluateAssertion(receipt, context).outcome).toBe('violated');
  });

  it('is indeterminate when the relational refund cannot be resolved to one record', () => {
    const ambiguous = contextWith({
      refunds: [refund('RFB-9201'), refund('RFB-9202')],
      emails: [email('MSG-1', { refundId: 'RFB-9201' })],
    });
    const result = evaluateAssertion(receipt, ambiguous);
    expect(result.outcome).toBe('indeterminate');
    expect(result.message).toContain('expected exactly one');

    const missing = contextWith({ refunds: [], emails: [email('MSG-1', {})] });
    expect(evaluateAssertion(receipt, missing).outcome).toBe('indeterminate');
  });

  it('is indeterminate when the target collection is absent', () => {
    expect(evaluateAssertion(receipt, contextWith({ refunds: [refund('R-1')] })).outcome).toBe(
      'indeterminate',
    );
  });

  it('matches a literally named prior refund without any relational lookup', () => {
    const prior: Assertion = {
      kind: 'record_exists_matching',
      state: 'final',
      collection: 'emails',
      where: [
        { field: 'to', equals: 'lee@example.com' },
        { field: 'status', equals: 'sent' },
        { field: 'refundId', equals: 'RF-8801' },
      ],
      minCount: 1,
    };
    const context = contextWith({
      emails: [
        email('MSG-OLD', { to: 'lee@example.com', refundId: null }),
        email('MSG-NEW', { to: 'lee@example.com', refundId: 'RF-8801' }),
      ],
    });
    // No refunds collection at all, and it still resolves: nothing relational.
    expect(evaluateAssertion(prior, context).outcome).toBe('satisfied');
  });

  it('honours a minCount above one', () => {
    const twice: Assertion = { ...receipt, minCount: 2 };
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [email('MSG-1', { refundId: 'RFB-9201' })],
    });
    expect(evaluateAssertion(twice, context).outcome).toBe('violated');
  });

  it('cites the source refund and the matching message', () => {
    const context = contextWith({
      refunds: [refund('RFB-9201')],
      emails: [email('MSG-OLD', { relatedOrderId: 'ORD-1900' }), email('MSG-NEW', { refundId: 'RFB-9201' })],
    });
    const refs = assertionEvidenceRefs(receipt, context);
    expect(refs).toContain('state:final.refunds.RFB-9201');
    expect(refs).toContain('state:final.emails.MSG-NEW');
    expect(refs).not.toContain('state:final.emails.MSG-OLD');
  });

  it('cites the collection when nothing matches', () => {
    const context = contextWith({ refunds: [refund('RFB-9201')], emails: [] });
    expect(assertionEvidenceRefs(receipt, context)).toContain('state:final.emails');
  });
});
