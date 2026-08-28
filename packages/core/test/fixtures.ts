import type { StateSnapshot, TraceEvent } from '@stateproof/core';

/** Small hand-built sandbox used by the core unit tests. */
export function snapshot(
  label: 'initial' | 'final',
  collections: StateSnapshot['collections'],
): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: `SNAP-${label.toUpperCase()}`,
    label,
    capturedAt: label === 'initial' ? '2025-03-04T09:00:00.000Z' : '2025-03-04T09:10:00.000Z',
    collections,
  };
}

export function approvalEvent(seq: number, scope: string): TraceEvent {
  return {
    eventId: `EV-${seq}`,
    seq,
    timestamp: `2025-03-04T09:0${seq}:00.000Z`,
    type: 'human_approval',
    approvalId: `APR-${seq}`,
    scope,
    approver: 'ops-lead@example.com',
    decision: 'approved',
  };
}

export function toolCallEvent(
  seq: number,
  toolName: string,
  args: Record<string, string> = {},
): TraceEvent {
  return {
    eventId: `EV-${seq}`,
    seq,
    timestamp: `2025-03-04T09:0${seq}:00.000Z`,
    type: 'tool_call',
    callId: `call-${seq}`,
    toolName,
    arguments: args,
  };
}
