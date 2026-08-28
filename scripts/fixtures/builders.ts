import type {
  JsonObject,
  JsonValue,
  Money,
  StateRecord,
  StateSnapshot,
  TraceEvent,
} from '@stateproof/core';

/** Shared, deterministic builders for PhantomBench fixture authoring. */

export const CURRENCY = 'USD';

export function money(amount: string): Money {
  return { amount, currency: CURRENCY };
}

/** All fixtures share one synthetic day, so ids and times stay comparable. */
const BASE_EPOCH_MS = Date.parse('2025-03-04T09:00:00.000Z');

/** Sequence position -> timestamp. 30s per step keeps ordering obvious. */
export function timestampForSeq(seq: number): string {
  return new Date(BASE_EPOCH_MS + seq * 30_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export function record(id: string, fields: JsonObject): StateRecord {
  return { id, fields };
}

export function order(
  id: string,
  customerName: string,
  customerEmail: string,
  status: 'processing' | 'delivered' | 'partially_refunded' | 'refunded' | 'cancelled',
  total: string,
  refundedTotal: string,
  placedAt: string,
  updatedAt: string,
): StateRecord {
  return record(id, {
    customerName,
    customerEmail,
    status,
    total: money(total),
    refundedTotal: money(refundedTotal),
    placedAt,
    updatedAt,
  });
}

export function supportCase(
  id: string,
  orderId: string,
  customerEmail: string,
  subject: string,
  status: 'open' | 'pending' | 'closed',
  notes: JsonValue[],
  openedAt: string,
  updatedAt: string,
): StateRecord {
  return record(id, { orderId, customerEmail, subject, status, notes, openedAt, updatedAt });
}

export function supportNote(
  noteId: string,
  text: string,
  author: string,
  addedAt: string,
  relatedRefundId: string | null,
): JsonObject {
  return { noteId, text, author, addedAt, relatedRefundId };
}

export function snapshot(
  caseId: string,
  label: 'initial' | 'final',
  collections: StateSnapshot['collections'],
  capturedAt: string,
): StateSnapshot {
  return {
    schemaVersion: '1.0.0',
    snapshotId: `SNAP-${caseId}-${label.toUpperCase()}`,
    label,
    capturedAt,
    collections,
  };
}

/**
 * Accumulates trace events with automatic, gap-free sequence numbers and
 * timestamps derived from the sequence, so no fixture depends on a clock.
 */
export class TrajectoryBuilder {
  private readonly events: TraceEvent[] = [];
  private callCount = 0;
  /** Explicit per-sequence timestamps, for reproducing a hand-authored case. */
  private readonly timestamps: readonly string[] | undefined;

  public constructor(timestamps?: readonly string[]) {
    this.timestamps = timestamps;
  }

  private next(): { seq: number; eventId: string; timestamp: string } {
    const seq = this.events.length + 1;
    const explicit = this.timestamps?.[seq - 1];
    if (this.timestamps !== undefined && explicit === undefined) {
      throw new Error(`no explicit timestamp supplied for seq ${seq}`);
    }
    return {
      seq,
      eventId: `EV-${String(seq).padStart(3, '0')}`,
      timestamp: explicit ?? timestampForSeq(seq),
    };
  }

  public say(content: string, role: 'assistant' | 'user' | 'system' = 'assistant'): this {
    this.events.push({ ...this.next(), type: 'agent_message', role, content });
    return this;
  }

  /** A read or write call plus its result, as one successful pair. */
  public callOk(toolName: string, args: JsonObject, result: JsonValue): this {
    return this.call(toolName, args, 'ok', result);
  }

  /** A call whose result is an error. Nothing may mutate as a consequence. */
  public callError(toolName: string, args: JsonObject, result: JsonValue): this {
    return this.call(toolName, args, 'error', result);
  }

  private call(
    toolName: string,
    args: JsonObject,
    status: 'ok' | 'error',
    result: JsonValue,
  ): this {
    this.callCount += 1;
    const callId = `call-${this.callCount}`;
    const callEvent = this.next();
    this.events.push({
      ...callEvent,
      type: 'tool_call',
      callId,
      toolName,
      arguments: args,
    });
    const resultEvent = this.next();
    this.events.push({
      ...resultEvent,
      type: 'tool_result',
      callId,
      toolName,
      status,
      result,
    });
    return this;
  }

  public approval(
    approvalId: string,
    scope: string,
    approver = 'ops-lead@example.com',
    decision: 'approved' | 'rejected' = 'approved',
    note?: string,
  ): this {
    const base = this.next();
    this.events.push({
      ...base,
      type: 'human_approval',
      approvalId,
      scope,
      approver,
      decision,
      ...(note === undefined ? {} : { note }),
    });
    return this;
  }

  public build(): TraceEvent[] {
    return this.events;
  }

  /** Timestamp of the last appended event; useful for snapshot capture times. */
  public lastTimestamp(): string {
    return timestampForSeq(this.events.length);
  }
}
