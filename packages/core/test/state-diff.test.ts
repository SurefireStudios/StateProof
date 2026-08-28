import { describe, expect, it } from 'vitest';
import { canonicalJson, combineHashes, diffSnapshots, hashJson } from '@stateproof/core';
import { snapshot } from './fixtures';

describe('diffSnapshots', () => {
  it('reports nothing when the sandbox is untouched', () => {
    const before = snapshot('initial', { orders: [{ id: 'ORD-1', fields: { status: 'new' } }] });
    const after = snapshot('final', { orders: [{ id: 'ORD-1', fields: { status: 'new' } }] });
    expect(diffSnapshots(before, after)).toEqual([]);
  });

  it('detects modified fields', () => {
    const before = snapshot('initial', { orders: [{ id: 'ORD-1', fields: { status: 'new', note: 'x' } }] });
    const after = snapshot('final', { orders: [{ id: 'ORD-1', fields: { status: 'refunded', note: 'x' } }] });
    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe('modified');
    expect(changes[0]?.changedFields).toEqual(['status']);
  });

  it('detects added and removed records', () => {
    const before = snapshot('initial', { orders: [{ id: 'ORD-1', fields: {} }] });
    const after = snapshot('final', { orders: [{ id: 'ORD-2', fields: {} }] });
    const kinds = diffSnapshots(before, after).map((change) => `${change.recordId}:${change.kind}`);
    expect(kinds).toEqual(['ORD-1:removed', 'ORD-2:added']);
  });

  it('is insensitive to record ordering inside a collection', () => {
    const before = snapshot('initial', {
      orders: [
        { id: 'ORD-1', fields: { status: 'a' } },
        { id: 'ORD-2', fields: { status: 'b' } },
      ],
    });
    const after = snapshot('final', {
      orders: [
        { id: 'ORD-2', fields: { status: 'b' } },
        { id: 'ORD-1', fields: { status: 'a' } },
      ],
    });
    expect(diffSnapshots(before, after)).toEqual([]);
  });

  it('treats a nested value change as a change to that field', () => {
    const before = snapshot('initial', {
      orders: [{ id: 'ORD-1', fields: { total: { amount: '10.00', currency: 'USD' } } }],
    });
    const after = snapshot('final', {
      orders: [{ id: 'ORD-1', fields: { total: { amount: '10.00', currency: 'EUR' } } }],
    });
    expect(diffSnapshots(before, after)[0]?.changedFields).toEqual(['total']);
  });
});

describe('canonical serialization', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('preserves array order', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('produces a stable hash across repeated calls', () => {
    const value = { orders: [{ id: 'ORD-1', fields: { status: 'refunded' } }] };
    expect(hashJson(value)).toBe(hashJson(value));
    expect(hashJson(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('combines part hashes independently of their order', () => {
    const a = ['x', 'a'.repeat(64)] as const;
    const b = ['y', 'b'.repeat(64)] as const;
    expect(combineHashes([a, b])).toBe(combineHashes([b, a]));
  });
});
