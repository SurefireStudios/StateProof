import { describe, expect, it } from 'vitest';
import {
  type StateSnapshot,
  type ToolRegistry,
  type TraceEvent,
  canonicalJson,
  replayTrajectory,
} from '@stateproof/core';

/**
 * A write effect either lands completely or not at all. Half-applying one —
 * creating the refund record and then failing an order validation — would
 * leave the replayed sandbox in a state no real run could produce.
 */

const registry: ToolRegistry = {
  schemaVersion: '1.0.0',
  tools: [
    { name: 'orders.get', description: 'Read.', access: 'read', parameters: { type: 'object' } },
    {
      name: 'refund.execute',
      description: 'Refund.',
      access: 'write',
      parameters: { type: 'object' },
    },
    {
      name: 'inventory.adjust',
      description: 'A write tool the replay engine does not implement.',
      access: 'write',
      parameters: { type: 'object' },
    },
  ],
};

function initialState(): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: 'SNAP-INITIAL',
    label: 'initial',
    capturedAt: '2025-03-04T09:00:00.000Z',
    collections: {
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
      ],
      refunds: [],
      emails: [],
    },
  };
}

function callPair(
  toolName: string,
  args: Record<string, unknown>,
  status: 'ok' | 'error',
  result: unknown,
): TraceEvent[] {
  return [
    {
      eventId: 'EV-001',
      seq: 1,
      timestamp: '2025-03-04T09:01:00.000Z',
      type: 'tool_call',
      callId: 'call-1',
      toolName,
      arguments: args as never,
    },
    {
      eventId: 'EV-002',
      seq: 2,
      timestamp: '2025-03-04T09:01:01.000Z',
      type: 'tool_result',
      callId: 'call-1',
      toolName,
      status,
      result: result as never,
    },
  ];
}

function expectUnchanged(collections: StateSnapshot['collections']): void {
  expect(canonicalJson(collections as never)).toBe(
    canonicalJson(initialState().collections as never),
  );
}

describe('write effects are atomic', () => {
  it('does not create a refund when the order does not exist', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair(
        'refund.execute',
        { orderId: 'ORD-404', amount: { amount: '10.00', currency: 'USD' }, reason: 'x' },
        'ok',
        { refundId: 'REF-1' },
      ),
      registry,
    );
    expect(replay.appliedWrites).toEqual([]);
    expect(replay.issues.map((issue) => issue.kind)).toContain('unresolved_reference');
    expectUnchanged(replay.collections);
  });

  it('does not partially create a refund when the currency does not match the order', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair(
        'refund.execute',
        { orderId: 'ORD-1', amount: { amount: '10.00', currency: 'EUR' }, reason: 'x' },
        'ok',
        { refundId: 'REF-1' },
      ),
      registry,
    );
    // The refund record is created before the money check in the effect body;
    // the transaction is what keeps it out of the committed state.
    expect(replay.collections['refunds']).toEqual([]);
    expect(replay.appliedWrites).toEqual([]);
    expectUnchanged(replay.collections);
  });

  it('does not mutate anything when the refund arguments are incomplete', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair('refund.execute', { orderId: 'ORD-1' }, 'ok', { refundId: 'REF-1' }),
      registry,
    );
    expect(replay.issues.map((issue) => issue.kind)).toContain('invalid_arguments');
    expectUnchanged(replay.collections);
  });

  it('does not mutate anything when the result carries no created id', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair(
        'refund.execute',
        { orderId: 'ORD-1', amount: { amount: '10.00', currency: 'USD' }, reason: 'x' },
        'ok',
        { acknowledged: true },
      ),
      registry,
    );
    expectUnchanged(replay.collections);
  });

  it('does not mutate anything when the tool call errored', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair(
        'refund.execute',
        { orderId: 'ORD-1', amount: { amount: '10.00', currency: 'USD' }, reason: 'x' },
        'error',
        { code: 'declined' },
      ),
      registry,
    );
    expect(replay.issues).toEqual([]);
    expectUnchanged(replay.collections);
  });

  it('does not mutate anything when the tool call never returned', () => {
    const [call] = callPair(
      'refund.execute',
      { orderId: 'ORD-1', amount: { amount: '10.00', currency: 'USD' }, reason: 'x' },
      'ok',
      {},
    );
    const replay = replayTrajectory(initialState(), [call as TraceEvent], registry);
    expectUnchanged(replay.collections);
  });

  it('does not mutate anything for an unsupported write tool', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair('inventory.adjust', { sku: 'SKU-1', delta: -1 }, 'ok', { ok: true }),
      registry,
    );
    expect(replay.issues.map((issue) => issue.kind)).toContain('unsupported_write');
    expectUnchanged(replay.collections);
  });

  it('commits a valid effect in full', () => {
    const replay = replayTrajectory(
      initialState(),
      callPair(
        'refund.execute',
        { orderId: 'ORD-1', amount: { amount: '50.00', currency: 'USD' }, reason: 'Damaged' },
        'ok',
        { refundId: 'REF-1' },
      ),
      registry,
    );
    expect(replay.issues).toEqual([]);
    expect(replay.appliedWrites).toEqual([1]);
    expect(replay.collections['refunds']).toHaveLength(1);
    expect(
      replay.collections['orders']?.find((record) => record.id === 'ORD-1')?.fields['status'],
    ).toBe('refunded');
  });
});
