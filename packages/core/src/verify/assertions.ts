import { MoneySchema, formatMoney, moneyEquals } from '../common';
import { type JsonValue, readPath } from '../json';
import type {
  Assertion,
  EventSelector,
  EvidenceSource,
  FieldMatch,
  RecordSelector,
} from '../schema/contract';
import type { StateRecord, StateSnapshot } from '../schema/state';
import type { TraceEvent } from '../schema/trace';
import type { AssertionOutcome } from '../schema/verdict';
import { canonicalJson, toJsonValue } from '../serialize/canonical';
import { changesInCollection, diffSnapshots } from './state-diff';

export interface EvaluationContext {
  readonly initialState: StateSnapshot;
  readonly finalState: StateSnapshot;
  readonly trajectory: readonly TraceEvent[];
  readonly finalResponse: string;
}

export interface AssertionEvidence {
  readonly source: EvidenceSource;
  readonly locator: string;
  readonly observed: JsonValue;
  readonly summary: string;
}

export interface AssertionResult {
  readonly outcome: AssertionOutcome;
  readonly message: string;
  readonly evidence: AssertionEvidence[];
}

/** `id` addresses the record id itself; anything else is a dotted field path. */
export function readRecordValue(record: StateRecord, field: string): JsonValue | undefined {
  if (field === 'id') return record.id;
  return readPath(record.fields, field);
}

function matchesAll(record: StateRecord, matchers: readonly FieldMatch[]): boolean {
  return matchers.every((matcher) => {
    const actual = readRecordValue(record, matcher.field);
    if (actual === undefined) return false;
    return canonicalJson(actual) === canonicalJson(matcher.equals);
  });
}

interface Selection {
  readonly collectionPresent: boolean;
  readonly records: StateRecord[];
}

function selectRecords(snapshot: StateSnapshot, selector: RecordSelector): Selection {
  const records = snapshot.collections[selector.collection];
  if (records === undefined) return { collectionPresent: false, records: [] };
  return {
    collectionPresent: true,
    records: records.filter((record) => matchesAll(record, selector.where)),
  };
}

function describeSelector(selector: RecordSelector): string {
  const where = selector.where
    .map((match) => `${match.field}=${canonicalJson(match.equals)}`)
    .join(' & ');
  return `${selector.collection}[${where}]`;
}

function stateSource(state: 'initial' | 'final'): EvidenceSource {
  return state === 'initial' ? 'initial_state' : 'final_state';
}

function snapshotFor(context: EvaluationContext, state: 'initial' | 'final'): StateSnapshot {
  return state === 'initial' ? context.initialState : context.finalState;
}

export function eventMatches(event: TraceEvent, selector: EventSelector): boolean {
  if (event.type !== selector.eventType) return false;

  if (selector.toolName !== undefined) {
    if (event.type !== 'tool_call' && event.type !== 'tool_result') return false;
    if (event.toolName !== selector.toolName) return false;
  }
  if (selector.status !== undefined) {
    if (event.type !== 'tool_result' || event.status !== selector.status) return false;
  }
  if (selector.scope !== undefined) {
    if (event.type !== 'human_approval' || event.scope !== selector.scope) return false;
  }
  if (selector.decision !== undefined) {
    if (event.type !== 'human_approval' || event.decision !== selector.decision) return false;
  }
  if (selector.argumentMatches !== undefined) {
    if (event.type !== 'tool_call') return false;
    const allMatch = selector.argumentMatches.every((matcher) => {
      const actual = readPath(event.arguments, matcher.field);
      if (actual === undefined) return false;
      return canonicalJson(actual) === canonicalJson(matcher.equals);
    });
    if (!allMatch) return false;
  }
  return true;
}

function describeEventSelector(selector: EventSelector): string {
  const parts: string[] = [selector.eventType];
  if (selector.toolName !== undefined) parts.push(`tool=${selector.toolName}`);
  if (selector.scope !== undefined) parts.push(`scope=${selector.scope}`);
  if (selector.decision !== undefined) parts.push(`decision=${selector.decision}`);
  if (selector.status !== undefined) parts.push(`status=${selector.status}`);
  if (selector.argumentMatches !== undefined) {
    for (const match of selector.argumentMatches) {
      parts.push(`${match.field}=${canonicalJson(match.equals)}`);
    }
  }
  return parts.join(' ');
}

function firstMatchingEvent(
  trajectory: readonly TraceEvent[],
  selector: EventSelector,
): TraceEvent | undefined {
  return trajectory.find((event) => eventMatches(event, selector));
}

/**
 * Evaluates one assertion against a case.
 *
 * `indeterminate` is reserved for genuinely missing evidence (an absent
 * collection, an ambiguous selector). Data that is present but wrong is
 * `violated`; it must never be softened into "needs review".
 */
export function evaluateAssertion(
  assertion: Assertion,
  context: EvaluationContext,
): AssertionResult {
  switch (assertion.kind) {
    case 'record_exists':
    case 'record_absent': {
      const snapshot = snapshotFor(context, assertion.state);
      const selection = selectRecords(snapshot, assertion.selector);
      const locator = `${assertion.state}_state.${describeSelector(assertion.selector)}`;

      if (!selection.collectionPresent) {
        return {
          outcome: 'indeterminate',
          message: `collection "${assertion.selector.collection}" is not present in the ${assertion.state} state`,
          evidence: [
            {
              source: stateSource(assertion.state),
              locator,
              observed: null,
              summary: 'collection missing from snapshot',
            },
          ],
        };
      }

      const found = selection.records.length;
      const shouldExist = assertion.kind === 'record_exists';
      const satisfied = shouldExist ? found > 0 : found === 0;
      return {
        outcome: satisfied ? 'satisfied' : 'violated',
        message: shouldExist
          ? `${found} record(s) matched ${describeSelector(assertion.selector)}; expected at least one`
          : `${found} record(s) matched ${describeSelector(assertion.selector)}; expected none`,
        evidence: [
          {
            source: stateSource(assertion.state),
            locator,
            observed: toJsonValue(selection.records),
            summary: `${found} matching record(s) in ${assertion.state} state`,
          },
        ],
      };
    }

    case 'record_field_equals':
    case 'record_money_equals': {
      const snapshot = snapshotFor(context, assertion.state);
      const selection = selectRecords(snapshot, assertion.selector);
      const locator = `${assertion.state}_state.${describeSelector(assertion.selector)}.${assertion.field}`;

      if (!selection.collectionPresent) {
        return {
          outcome: 'indeterminate',
          message: `collection "${assertion.selector.collection}" is not present in the ${assertion.state} state`,
          evidence: [
            {
              source: stateSource(assertion.state),
              locator,
              observed: null,
              summary: 'collection missing from snapshot',
            },
          ],
        };
      }
      if (selection.records.length > 1) {
        return {
          outcome: 'indeterminate',
          message: `selector ${describeSelector(assertion.selector)} matched ${selection.records.length} records; expected exactly one`,
          evidence: [
            {
              source: stateSource(assertion.state),
              locator,
              observed: toJsonValue(selection.records.map((record) => record.id)),
              summary: 'ambiguous selector',
            },
          ],
        };
      }

      const record = selection.records[0];
      if (record === undefined) {
        return {
          outcome: 'violated',
          message: `no record matched ${describeSelector(assertion.selector)}`,
          evidence: [
            {
              source: stateSource(assertion.state),
              locator,
              observed: null,
              summary: 'no matching record',
            },
          ],
        };
      }

      const actual = readRecordValue(record, assertion.field);
      if (actual === undefined) {
        return {
          outcome: 'violated',
          message: `record ${record.id} has no field "${assertion.field}"`,
          evidence: [
            {
              source: stateSource(assertion.state),
              locator,
              observed: null,
              summary: 'field absent on matched record',
            },
          ],
        };
      }

      if (assertion.kind === 'record_money_equals') {
        const parsed = MoneySchema.safeParse(actual);
        if (!parsed.success) {
          return {
            outcome: 'violated',
            message: `record ${record.id} field "${assertion.field}" is not a money value`,
            evidence: [
              {
                source: stateSource(assertion.state),
                locator,
                observed: actual,
                summary: 'malformed money value',
              },
            ],
          };
        }
        const equal = moneyEquals(parsed.data, assertion.expected);
        return {
          outcome: equal ? 'satisfied' : 'violated',
          message: `${record.id}.${assertion.field} = ${formatMoney(parsed.data)}; expected ${formatMoney(assertion.expected)}`,
          evidence: [
            {
              source: stateSource(assertion.state),
              locator,
              observed: actual,
              summary: `observed ${formatMoney(parsed.data)}`,
            },
          ],
        };
      }

      const equal = canonicalJson(actual) === canonicalJson(assertion.expected);
      return {
        outcome: equal ? 'satisfied' : 'violated',
        message: `${record.id}.${assertion.field} = ${canonicalJson(actual)}; expected ${canonicalJson(assertion.expected)}`,
        evidence: [
          {
            source: stateSource(assertion.state),
            locator,
            observed: actual,
            summary: `observed ${canonicalJson(actual)}`,
          },
        ],
      };
    }

    case 'event_order': {
      const earlier = firstMatchingEvent(context.trajectory, assertion.earlier);
      const later = firstMatchingEvent(context.trajectory, assertion.later);
      const locator = 'trajectory';
      const observed = toJsonValue({
        earlier: earlier === undefined ? null : { eventId: earlier.eventId, seq: earlier.seq },
        later: later === undefined ? null : { eventId: later.eventId, seq: later.seq },
      });

      if (earlier === undefined && later === undefined) {
        return {
          outcome: 'indeterminate',
          message: `neither "${describeEventSelector(assertion.earlier)}" nor "${describeEventSelector(assertion.later)}" appears in the trajectory`,
          evidence: [{ source: 'trajectory', locator, observed, summary: 'no matching events' }],
        };
      }
      if (later === undefined) {
        // The protected action never happened, so nothing could precede it.
        // Outcome requirements are what should fail in that situation.
        return {
          outcome: 'satisfied',
          message: `"${describeEventSelector(assertion.later)}" never occurred; ordering requirement is vacuously satisfied`,
          evidence: [
            { source: 'trajectory', locator, observed, summary: 'protected action absent' },
          ],
        };
      }
      if (earlier === undefined) {
        return {
          outcome: 'violated',
          message: `"${describeEventSelector(assertion.later)}" occurred at seq ${later.seq} but "${describeEventSelector(assertion.earlier)}" never occurred`,
          evidence: [
            { source: 'trajectory', locator, observed, summary: 'required prior event absent' },
          ],
        };
      }

      const ordered = earlier.seq < later.seq;
      return {
        outcome: ordered ? 'satisfied' : 'violated',
        message: ordered
          ? `"${describeEventSelector(assertion.earlier)}" (seq ${earlier.seq}) precedes "${describeEventSelector(assertion.later)}" (seq ${later.seq})`
          : `"${describeEventSelector(assertion.earlier)}" occurred at seq ${earlier.seq}, after "${describeEventSelector(assertion.later)}" at seq ${later.seq}`,
        evidence: [
          {
            source: 'trajectory',
            locator,
            observed,
            summary: `earlier seq ${earlier.seq}, later seq ${later.seq}`,
          },
        ],
      };
    }

    case 'no_new_records':
    case 'no_unrelated_mutations': {
      const changes = changesInCollection(
        diffSnapshots(context.initialState, context.finalState),
        assertion.collection,
      );
      const relevant =
        assertion.kind === 'no_new_records'
          ? changes.filter((change) => change.kind === 'added')
          : changes;
      const allowed = new Set(assertion.allowedRecordIds);
      const offending = relevant.filter((change) => !allowed.has(change.recordId));
      const noun = assertion.kind === 'no_new_records' ? 'record creation' : 'mutation';

      return {
        outcome: offending.length === 0 ? 'satisfied' : 'violated',
        message:
          offending.length === 0
            ? `no disallowed ${noun} in "${assertion.collection}"`
            : `disallowed change(s) in "${assertion.collection}": ${offending
                .map((change) => `${change.recordId} (${change.kind})`)
                .join(', ')}`,
        evidence: [
          {
            source: 'final_state',
            locator: `state_diff.${assertion.collection}`,
            observed: toJsonValue(
              relevant.map((change) => ({
                recordId: change.recordId,
                kind: change.kind,
                changedFields: change.changedFields,
              })),
            ),
            summary: `${relevant.length} change(s) observed in "${assertion.collection}"`,
          },
        ],
      };
    }
  }
}
