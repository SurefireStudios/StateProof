import { type JsonObject, type JsonValue, isJsonObject, readPath } from '../json';
import { MoneySchema, type Money, normalizeAmount } from '../common';
import type { StateRecord, StateSnapshot } from '../schema/state';
import type { ToolRegistry } from '../schema/tool';
import type { ToolCallEvent, TraceEvent } from '../schema/trace';
import { canonicalJson } from '../serialize/canonical';
import { findTool } from '../schema/tool';
import {
  REFUND_OPS_ACTOR,
  REFUND_OPS_SUPPORT_MAILBOX,
  REFUND_OPS_WRITE_EFFECTS,
} from './refund-ops';

/**
 * A deterministic replay of the refund-operations sandbox.
 *
 * This is not a general workflow engine. It supports exactly the write
 * operations the twelve PhantomBench cases use, so that fixture validation can
 * prove the final state is *derivable* from the initial state plus the
 * successful write events, rather than trusting a hand-authored file.
 *
 * Two rules make the replay meaningful:
 *   - read-only tools never mutate state;
 *   - a tool call whose result is missing or `error` never mutates state.
 *
 * Timestamps come from the `tool_call` event, so replay output is a pure
 * function of the trajectory with no clock reads.
 */

export interface ReplayIssue {
  readonly kind:
    | 'unsupported_write'
    | 'unresolved_reference'
    | 'invalid_arguments'
    | 'no_effect'
    | 'unexpected_effect'
    | 'mismatch';
  readonly message: string;
  /** Trajectory sequence number, when the issue belongs to one event. */
  readonly seq: number | null;
}

export interface ReplayResult {
  readonly collections: StateSnapshot['collections'];
  readonly issues: ReplayIssue[];
  /** Sequence numbers of write calls that were applied successfully. */
  readonly appliedWrites: number[];
}

type MutableCollections = Record<string, StateRecord[]>;

function cloneCollections(snapshot: StateSnapshot): MutableCollections {
  return JSON.parse(JSON.stringify(snapshot.collections)) as MutableCollections;
}

function findRecord(
  collections: MutableCollections,
  collection: string,
  recordId: string,
): StateRecord | undefined {
  return collections[collection]?.find((record) => record.id === recordId);
}

function readString(source: JsonObject, path: string): string | undefined {
  const value = readPath(source, path);
  return typeof value === 'string' ? value : undefined;
}

function readMoney(source: JsonObject, path: string): Money | undefined {
  const parsed = MoneySchema.safeParse(readPath(source, path));
  return parsed.success ? parsed.data : undefined;
}

/** Adds two same-currency amounts without touching floating point. */
function addMoney(left: Money, right: Money): Money | undefined {
  if (left.currency !== right.currency) return undefined;
  const toMinor = (amount: string): number => {
    const match = /^(-?)(\d+)\.(\d{2})$/.exec(normalizeAmount(amount));
    if (match === null) return Number.NaN;
    const [, sign = '', whole = '0', fraction = '00'] = match;
    const magnitude = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
    return sign === '-' ? -magnitude : magnitude;
  };
  const total = toMinor(left.amount) + toMinor(right.amount);
  if (!Number.isFinite(total)) return undefined;
  const sign = total < 0 ? '-' : '';
  const magnitude = Math.abs(total);
  return {
    amount: `${sign}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`,
    currency: left.currency,
  };
}

function compareMoney(left: Money, right: Money): number {
  const sum = addMoney(left, { amount: `-${normalizeAmount(right.amount)}`, currency: right.currency });
  if (sum === undefined) return Number.NaN;
  return Number.parseFloat(sum.amount);
}


/** `collection/id -> canonical fields`, for detecting exactly what an effect touched. */
function recordFingerprints(collections: MutableCollections): Map<string, string> {
  const fingerprints = new Map<string, string>();
  for (const [collection, records] of Object.entries(collections)) {
    for (const entry of records) {
      fingerprints.set(`${collection}/${entry.id}`, canonicalJson(entry.fields));
    }
  }
  return fingerprints;
}

function changedRefs(before: Map<string, string>, after: Map<string, string>): string[] {
  const refs = new Set([...before.keys(), ...after.keys()]);
  return [...refs].filter((ref) => before.get(ref) !== after.get(ref)).sort();
}

/**
 * The records a successful write is allowed to touch, derived from its own
 * arguments and result. Anything else changing is a replay bug or a fixture
 * that was edited by hand.
 */
function expectedTouchedRefs(call: ToolCallEvent, result: JsonValue): string[] {
  const args = call.arguments;
  const resultObject = isJsonObject(result) ? result : {};
  switch (call.toolName) {
    case 'refund.execute': {
      const refundId = readString(resultObject, 'refundId');
      const orderId = readString(args, 'orderId');
      return [
        ...(refundId === undefined ? [] : [`refunds/${refundId}`]),
        ...(orderId === undefined ? [] : [`orders/${orderId}`]),
      ];
    }
    case 'email.send':
    case 'email.draft': {
      const messageId = readString(resultObject, 'messageId');
      return messageId === undefined ? [] : [`emails/${messageId}`];
    }
    case 'support.add_note':
    case 'support.update': {
      const caseId = readString(args, 'caseId');
      return caseId === undefined ? [] : [`support_cases/${caseId}`];
    }
    case 'orders.update': {
      const orderId = readString(args, 'orderId');
      return orderId === undefined ? [] : [`orders/${orderId}`];
    }
    default:
      return [];
  }
}

interface EffectContext {
  readonly collections: MutableCollections;
  readonly call: ToolCallEvent;
  readonly result: JsonValue;
  readonly issues: ReplayIssue[];
}

function issue(context: EffectContext, kind: ReplayIssue['kind'], message: string): false {
  context.issues.push({ kind, message, seq: context.call.seq });
  return false;
}

/** Creates the refund record and settles the order it belongs to. */
function applyRefundExecute(context: EffectContext): boolean {
  const { collections, call } = context;
  const args = call.arguments;
  const refundId = isJsonObject(context.result) ? readString(context.result, 'refundId') : undefined;
  const orderId = readString(args, 'orderId');
  const amount = readMoney(args, 'amount');
  const reason = readString(args, 'reason');

  if (refundId === undefined) {
    return issue(context, 'invalid_arguments', 'refund.execute result carries no refundId');
  }
  if (orderId === undefined || amount === undefined || reason === undefined) {
    return issue(context, 'invalid_arguments', 'refund.execute needs orderId, amount and reason');
  }
  const order = findRecord(collections, 'orders', orderId);
  if (order === undefined) {
    return issue(context, 'unresolved_reference', `refund.execute targets unknown order ${orderId}`);
  }

  const refunds = collections['refunds'];
  if (refunds === undefined) {
    return issue(context, 'unresolved_reference', 'the sandbox has no refunds collection');
  }
  if (refunds.some((record) => record.id === refundId)) {
    return issue(context, 'unresolved_reference', `refund ${refundId} already exists`);
  }

  refunds.push({
    id: refundId,
    fields: {
      orderId,
      amount: { amount: normalizeAmount(amount.amount), currency: amount.currency },
      status: 'succeeded',
      reason,
      approvalReference: readString(args, 'approvalReference') ?? null,
      executedBy: REFUND_OPS_ACTOR,
      executedAt: call.timestamp,
    },
  });

  const previousRefunded = readMoney(order.fields, 'refundedTotal');
  const orderTotal = readMoney(order.fields, 'total');
  if (previousRefunded === undefined || orderTotal === undefined) {
    return issue(context, 'invalid_arguments', `order ${orderId} has no usable money fields`);
  }
  const refundedTotal = addMoney(previousRefunded, amount);
  if (refundedTotal === undefined) {
    return issue(context, 'invalid_arguments', `refund currency does not match order ${orderId}`);
  }

  order.fields['refundedTotal'] = refundedTotal;
  order.fields['status'] = compareMoney(refundedTotal, orderTotal) >= 0 ? 'refunded' : 'partially_refunded';
  order.fields['updatedAt'] = call.timestamp;
  return true;
}

/**
 * Creates the outbox message. `email.send` produces a `sent` message with a
 * delivery timestamp; `email.draft` produces a `draft` with none. The
 * distinction matters: a drafted receipt has not reached anybody.
 */
function applyEmailSend(context: EffectContext, delivered: boolean): boolean {
  const { collections, call } = context;
  const args = call.arguments;
  const messageId = isJsonObject(context.result)
    ? readString(context.result, 'messageId')
    : undefined;
  const to = readString(args, 'to');
  const subject = readString(args, 'subject');
  const body = readString(args, 'body');

  if (messageId === undefined) {
    return issue(context, 'invalid_arguments', `${call.toolName} result carries no messageId`);
  }
  if (to === undefined || subject === undefined || body === undefined) {
    return issue(context, 'invalid_arguments', `${call.toolName} needs to, subject and body`);
  }
  const emails = collections['emails'];
  if (emails === undefined) {
    return issue(context, 'unresolved_reference', 'the sandbox has no emails collection');
  }
  if (emails.some((record) => record.id === messageId)) {
    return issue(context, 'unresolved_reference', `message ${messageId} already exists`);
  }

  emails.push({
    id: messageId,
    fields: {
      to,
      from: REFUND_OPS_SUPPORT_MAILBOX,
      subject,
      body,
      relatedOrderId: readString(args, 'relatedOrderId') ?? null,
      refundId: readString(args, 'refundId') ?? null,
      status: delivered ? 'sent' : 'draft',
      sentAt: delivered ? call.timestamp : null,
    },
  });
  return true;
}

/** Appends one note to a support case. Notes are append-only. */
function applySupportAddNote(context: EffectContext): boolean {
  const { collections, call } = context;
  const args = call.arguments;
  const noteId = isJsonObject(context.result) ? readString(context.result, 'noteId') : undefined;
  const caseId = readString(args, 'caseId');
  const text = readString(args, 'text');

  if (noteId === undefined) {
    return issue(context, 'invalid_arguments', 'support.add_note result carries no noteId');
  }
  if (caseId === undefined || text === undefined) {
    return issue(context, 'invalid_arguments', 'support.add_note needs caseId and text');
  }
  const supportCase = findRecord(collections, 'support_cases', caseId);
  if (supportCase === undefined) {
    return issue(
      context,
      'unresolved_reference',
      `support.add_note targets unknown support case ${caseId}`,
    );
  }
  const notes = supportCase.fields['notes'];
  if (!Array.isArray(notes)) {
    return issue(context, 'invalid_arguments', `support case ${caseId} has no notes array`);
  }

  notes.push({
    noteId,
    text,
    author: REFUND_OPS_ACTOR,
    addedAt: call.timestamp,
    relatedRefundId: readString(args, 'relatedRefundId') ?? null,
  });
  supportCase.fields['updatedAt'] = call.timestamp;
  return true;
}

/** Applies an explicit field patch to a record and stamps `updatedAt`. */
function applyRecordUpdate(
  context: EffectContext,
  collection: string,
  idArgument: string,
): boolean {
  const { collections, call } = context;
  const recordId = readString(call.arguments, idArgument);
  const patch = readPath(call.arguments, 'fields');

  if (recordId === undefined) {
    return issue(context, 'invalid_arguments', `${call.toolName} needs ${idArgument}`);
  }
  if (!isJsonObject(patch)) {
    return issue(context, 'invalid_arguments', `${call.toolName} needs a fields object`);
  }
  const record = findRecord(collections, collection, recordId);
  if (record === undefined) {
    return issue(
      context,
      'unresolved_reference',
      `${call.toolName} targets unknown ${collection} record ${recordId}`,
    );
  }
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    record.fields[field] = value;
  }
  record.fields['updatedAt'] = call.timestamp;
  return true;
}

function applyEffect(context: EffectContext): boolean {
  switch (context.call.toolName) {
    case 'refund.execute':
      return applyRefundExecute(context);
    case 'email.send':
      return applyEmailSend(context, true);
    case 'email.draft':
      return applyEmailSend(context, false);
    case 'support.add_note':
      return applySupportAddNote(context);
    case 'orders.update':
      return applyRecordUpdate(context, 'orders', 'orderId');
    case 'support.update':
      return applyRecordUpdate(context, 'support_cases', 'caseId');
    default:
      return issue(
        context,
        'unsupported_write',
        `no replay effect is implemented for write tool "${context.call.toolName}"`,
      );
  }
}

/**
 * Rebuilds the final state from the initial state and the trajectory.
 * Only successful calls to write tools mutate anything.
 */
export function replayTrajectory(
  initialState: StateSnapshot,
  trajectory: readonly TraceEvent[],
  registry: ToolRegistry,
): ReplayResult {
  const collections = cloneCollections(initialState);
  const issues: ReplayIssue[] = [];
  const appliedWrites: number[] = [];

  const results = new Map<string, { status: 'ok' | 'error'; payload: JsonValue }>();
  for (const event of trajectory) {
    if (event.type === 'tool_result') {
      results.set(event.callId, { status: event.status, payload: event.result });
    }
  }

  for (const event of trajectory) {
    if (event.type !== 'tool_call') continue;

    const tool = findTool(registry, event.toolName);
    if (tool === undefined) {
      issues.push({
        kind: 'unresolved_reference',
        message: `seq ${event.seq} calls "${event.toolName}", which is not in the tool registry`,
        seq: event.seq,
      });
      continue;
    }
    // Read-only tools never mutate, whatever they return.
    if (tool.access !== 'write') continue;

    const outcome = results.get(event.callId);
    // A failed call, or one that never returned, leaves the sandbox untouched.
    if (outcome === undefined || outcome.status !== 'ok') continue;

    const declaredEffects = REFUND_OPS_WRITE_EFFECTS[event.toolName];
    if (declaredEffects !== undefined && declaredEffects.length === 0) continue;

    // Effects are transactional: they run against a clone and are committed
    // only if the whole effect succeeds. A validation that fails halfway
    // through must not leave a half-created record behind.
    const before = recordFingerprints(collections);
    const staged = JSON.parse(JSON.stringify(collections)) as MutableCollections;
    const effectIssues: ReplayIssue[] = [];
    const applied = applyEffect({
      collections: staged,
      call: event,
      result: outcome.payload,
      issues: effectIssues,
    });
    if (!applied) {
      issues.push(...effectIssues);
      continue;
    }

    const touched = changedRefs(before, recordFingerprints(staged));
    if (touched.length === 0) {
      issues.push({
        kind: 'no_effect',
        message: `seq ${event.seq}: successful write "${event.toolName}" changed nothing`,
        seq: event.seq,
      });
      continue;
    }

    // The effect must land on exactly the entities the call and its result name.
    const expected = new Set(expectedTouchedRefs(event, outcome.payload));
    const unexpected = touched.filter((ref) => !expected.has(ref));
    if (unexpected.length > 0) {
      effectIssues.push({
        kind: 'unexpected_effect',
        message: `seq ${event.seq}: "${event.toolName}" also changed ${unexpected.join(', ')}`,
        seq: event.seq,
      });
    }
    const missing = [...expected].filter((ref) => !touched.includes(ref));
    if (missing.length > 0) {
      effectIssues.push({
        kind: 'no_effect',
        message: `seq ${event.seq}: "${event.toolName}" did not change ${missing.join(', ')}`,
        seq: event.seq,
      });
    }

    if (effectIssues.length > 0) {
      // Roll back: the staged clone is discarded and `collections` is untouched.
      issues.push(...effectIssues);
      continue;
    }

    // Commit the staged clone.
    for (const key of Object.keys(collections)) delete collections[key];
    for (const [key, records] of Object.entries(staged)) collections[key] = records;
    appliedWrites.push(event.seq);
  }

  return { collections, issues, appliedWrites };
}

export interface ReplayComparison {
  readonly matches: boolean;
  readonly issues: ReplayIssue[];
  readonly appliedWrites: number[];
}

/**
 * Replays the trajectory and compares the result with the recorded final
 * state. Only `collections` are compared: snapshot id, label and capture time
 * are bookkeeping, not sandbox content.
 */
export function verifyFinalStateDerivable(
  initialState: StateSnapshot,
  finalState: StateSnapshot,
  trajectory: readonly TraceEvent[],
  registry: ToolRegistry,
): ReplayComparison {
  const replay = replayTrajectory(initialState, trajectory, registry);
  const issues = [...replay.issues];

  const expected = canonicalJson(finalState.collections as unknown as JsonValue);
  const actual = canonicalJson(replay.collections as unknown as JsonValue);
  const matches = expected === actual;

  if (!matches) {
    issues.push({
      kind: 'mismatch',
      message: `replayed state does not equal final-state.json${describeFirstDifference(finalState.collections, replay.collections)}`,
      seq: null,
    });
  }

  return { matches, issues, appliedWrites: replay.appliedWrites };
}

/** Points at the first differing record so a fixture error is actionable. */
function describeFirstDifference(
  expected: StateSnapshot['collections'],
  actual: StateSnapshot['collections'],
): string {
  const collections = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const collection of collections) {
    const expectedRecords = expected[collection] ?? [];
    const actualRecords = actual[collection] ?? [];
    const ids = [
      ...new Set([
        ...expectedRecords.map((record) => record.id),
        ...actualRecords.map((record) => record.id),
      ]),
    ].sort();
    for (const id of ids) {
      const expectedRecord = expectedRecords.find((record) => record.id === id);
      const actualRecord = actualRecords.find((record) => record.id === id);
      const expectedJson = expectedRecord === undefined ? '<absent>' : canonicalJson(expectedRecord.fields);
      const actualJson = actualRecord === undefined ? '<absent>' : canonicalJson(actualRecord.fields);
      if (expectedJson !== actualJson) {
        return `; first difference at ${collection}/${id}: fixture ${expectedJson} vs replay ${actualJson}`;
      }
    }
  }
  return '';
}
