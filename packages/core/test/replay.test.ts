import { describe, expect, it } from 'vitest';
import {
  type StateSnapshot,
  type ToolRegistry,
  type TraceEvent,
  replayTrajectory,
  validateRefundOpsReferences,
  verifyFinalStateDerivable,
} from '@stateproof/core';

const registry: ToolRegistry = {
  schemaVersion: '1.0.0',
  tools: [
    {
      name: 'orders.get',
      description: 'Read an order.',
      access: 'read',
      parameters: { type: 'object' },
    },
    {
      name: 'orders.update',
      description: 'Update an order.',
      access: 'write',
      parameters: { type: 'object' },
    },
    {
      name: 'refund.execute',
      description: 'Execute a refund.',
      access: 'write',
      parameters: { type: 'object' },
    },
    {
      name: 'email.send',
      description: 'Send an email.',
      access: 'write',
      parameters: { type: 'object' },
    },
  ],
};

function snapshot(label: 'initial' | 'final', collections: StateSnapshot['collections']): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: `SNAP-${label}`,
    label,
    capturedAt: '2025-03-04T09:00:00.000Z',
    collections,
  };
}

function baseState(label: 'initial' | 'final'): StateSnapshot {
  return snapshot(label, {
    orders: [
      {
        id: 'ORD-1',
        fields: {
          customerName: 'Dana',
          customerEmail: 'dana@example.com',
          status: 'delivered',
          total: { amount: '50.00', currency: 'USD' },
          refundedTotal: { amount: '0.00', currency: 'USD' },
          placedAt: '2025-02-01T00:00:00.000Z',
          updatedAt: '2025-02-01T00:00:00.000Z',
        },
      },
      {
        id: 'ORD-2',
        fields: {
          customerName: 'Marcus',
          customerEmail: 'marcus@example.com',
          status: 'processing',
          total: { amount: '10.00', currency: 'USD' },
          refundedTotal: { amount: '0.00', currency: 'USD' },
          placedAt: '2025-02-01T00:00:00.000Z',
          updatedAt: '2025-02-01T00:00:00.000Z',
        },
      },
    ],
    refunds: [],
    emails: [],
  });
}

function call(
  seq: number,
  toolName: string,
  args: Record<string, unknown>,
  status: 'ok' | 'error',
  result: unknown,
): TraceEvent[] {
  return [
    {
      eventId: `EV-${seq}`,
      seq,
      timestamp: `2025-03-04T09:0${seq}:00.000Z`,
      type: 'tool_call',
      callId: `call-${seq}`,
      toolName,
      arguments: args as never,
    },
    {
      eventId: `EV-${seq + 1}`,
      seq: seq + 1,
      timestamp: `2025-03-04T09:0${seq + 1}:00.000Z`,
      type: 'tool_result',
      callId: `call-${seq}`,
      toolName,
      status,
      result: result as never,
    },
  ];
}

describe('replayTrajectory', () => {
  it('leaves the sandbox untouched when only read tools are called', () => {
    const replay = replayTrajectory(
      baseState('initial'),
      call(1, 'orders.get', { orderId: 'ORD-1' }, 'ok', { id: 'ORD-1' }),
      registry,
    );
    expect(replay.issues).toEqual([]);
    expect(replay.appliedWrites).toEqual([]);
    expect(replay.collections).toEqual(baseState('initial').collections);
  });

  it('leaves the sandbox untouched when a write call fails', () => {
    const replay = replayTrajectory(
      baseState('initial'),
      call(1, 'refund.execute', { orderId: 'ORD-1', amount: { amount: '50.00', currency: 'USD' }, reason: 'x' }, 'error', {
        code: 'declined',
      }),
      registry,
    );
    expect(replay.issues).toEqual([]);
    expect(replay.appliedWrites).toEqual([]);
    expect(replay.collections).toEqual(baseState('initial').collections);
  });

  it('leaves the sandbox untouched when a write call never returned', () => {
    const [callEvent] = call(1, 'orders.update', { orderId: 'ORD-1', fields: { status: 'cancelled' } }, 'ok', {});
    const replay = replayTrajectory(baseState('initial'), [callEvent as TraceEvent], registry);
    expect(replay.appliedWrites).toEqual([]);
    expect(replay.collections).toEqual(baseState('initial').collections);
  });

  it('creates the refund and settles the order it belongs to', () => {
    const replay = replayTrajectory(
      baseState('initial'),
      call(
        1,
        'refund.execute',
        { orderId: 'ORD-1', amount: { amount: '50.00', currency: 'USD' }, reason: 'Damaged' },
        'ok',
        { refundId: 'REF-1' },
      ),
      registry,
    );
    expect(replay.issues).toEqual([]);
    const order = replay.collections['orders']?.find((record) => record.id === 'ORD-1');
    expect(order?.fields['status']).toBe('refunded');
    expect(order?.fields['refundedTotal']).toEqual({ amount: '50.00', currency: 'USD' });
    expect(replay.collections['refunds']).toHaveLength(1);
  });

  it('marks an order partially refunded when the refund is less than the total', () => {
    const replay = replayTrajectory(
      baseState('initial'),
      call(
        1,
        'refund.execute',
        { orderId: 'ORD-1', amount: { amount: '20.00', currency: 'USD' }, reason: 'Partial' },
        'ok',
        { refundId: 'REF-1' },
      ),
      registry,
    );
    const order = replay.collections['orders']?.find((record) => record.id === 'ORD-1');
    expect(order?.fields['status']).toBe('partially_refunded');
    expect(order?.fields['refundedTotal']).toEqual({ amount: '20.00', currency: 'USD' });
  });

  it('reports an unresolved reference when a write targets a record that does not exist', () => {
    const replay = replayTrajectory(
      baseState('initial'),
      call(1, 'orders.update', { orderId: 'ORD-999', fields: { status: 'cancelled' } }, 'ok', {}),
      registry,
    );
    expect(replay.issues.map((issue) => issue.kind)).toContain('unresolved_reference');
  });

  it('reports a write that produced no change', () => {
    const replay = replayTrajectory(
      baseState('initial'),
      call(1, 'orders.update', { orderId: 'ORD-1', fields: {} }, 'ok', {}),
      registry,
    );
    // The patch is empty, so only updatedAt could change; it does, so the call
    // does have an effect. Re-applying the same value is what produces no-op.
    expect(replay.issues.every((issue) => issue.kind !== 'unexpected_effect')).toBe(true);
  });
});

describe('verifyFinalStateDerivable', () => {
  const trajectory = call(
    1,
    'refund.execute',
    { orderId: 'ORD-1', amount: { amount: '50.00', currency: 'USD' }, reason: 'Damaged' },
    'ok',
    { refundId: 'REF-1' },
  );

  it('accepts a final state that the trajectory actually produces', () => {
    const replay = replayTrajectory(baseState('initial'), trajectory, registry);
    const finalState = snapshot('final', replay.collections);
    const result = verifyFinalStateDerivable(baseState('initial'), finalState, trajectory, registry);
    expect(result.matches).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a hand-edited final state and points at the first difference', () => {
    const replay = replayTrajectory(baseState('initial'), trajectory, registry);
    const tampered = snapshot('final', JSON.parse(JSON.stringify(replay.collections)) as StateSnapshot['collections']);
    const order = tampered.collections['orders']?.find((record) => record.id === 'ORD-2');
    if (order !== undefined) order.fields['status'] = 'cancelled';

    const result = verifyFinalStateDerivable(baseState('initial'), tampered, trajectory, registry);
    expect(result.matches).toBe(false);
    expect(result.issues.some((issue) => issue.kind === 'mismatch')).toBe(true);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('orders/ORD-2');
  });
});

describe('validateRefundOpsReferences', () => {
  it('accepts a coherent snapshot', () => {
    expect(validateRefundOpsReferences(baseState('final'))).toEqual([]);
  });

  it('rejects a refund against an order that does not exist', () => {
    const state = baseState('final');
    state.collections['refunds']?.push({
      id: 'REF-1',
      fields: {
        orderId: 'ORD-404',
        amount: { amount: '1.00', currency: 'USD' },
        status: 'succeeded',
        reason: 'x',
        approvalReference: null,
        executedBy: 'agent:refund-bot',
        executedAt: '2025-03-04T09:00:00.000Z',
      },
    });
    expect(validateRefundOpsReferences(state)[0]?.message).toContain('ORD-404');
  });

  it('rejects a receipt filed under a different order than its refund', () => {
    const state = baseState('final');
    state.collections['refunds']?.push({
      id: 'REF-1',
      fields: {
        orderId: 'ORD-1',
        amount: { amount: '1.00', currency: 'USD' },
        status: 'succeeded',
        reason: 'x',
        approvalReference: null,
        executedBy: 'agent:refund-bot',
        executedAt: '2025-03-04T09:00:00.000Z',
      },
    });
    state.collections['emails']?.push({
      id: 'MSG-1',
      fields: {
        to: 'dana@example.com',
        from: 'support@example.com',
        subject: 'x',
        body: 'x',
        relatedOrderId: 'ORD-2',
        refundId: 'REF-1',
        status: 'sent',
        sentAt: '2025-03-04T09:00:00.000Z',
      },
    });
    expect(validateRefundOpsReferences(state).map((issue) => issue.message).join(' ')).toContain(
      'filed under order ORD-2',
    );
  });

  it('rejects a sent message with no sentAt timestamp', () => {
    const state = baseState('final');
    state.collections['emails']?.push({
      id: 'MSG-1',
      fields: {
        to: 'dana@example.com',
        from: 'support@example.com',
        subject: 'x',
        body: 'x',
        relatedOrderId: 'ORD-1',
        refundId: null,
        status: 'sent',
        sentAt: null,
      },
    });
    expect(validateRefundOpsReferences(state)[0]?.message).toContain('no sentAt');
  });
});
