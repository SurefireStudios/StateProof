import type { Assertion } from '../schema/contract';
import { type EvaluationContext, firstMatchingEvent, selectRecords, snapshotFor } from './assertions';
import { changesInCollection, diffSnapshots } from './state-diff';

/**
 * Builds evidence references from the records and events an assertion actually
 * matched.
 *
 * These are generated from the data, never written by a model, so a StateProof
 * citation cannot point at something that does not exist. Every reference here
 * resolves against the same case the assertion was evaluated on.
 */

function stateRef(state: 'initial' | 'final', collection: string, recordId: string, field?: string): string {
  const base = `state:${state}.${collection}.${recordId}`;
  return field === undefined ? base : `${base}.${field}`;
}

/** Deduplicated, sorted, so the same evidence always serializes identically. */
function stable(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort();
}

export function assertionEvidenceRefs(
  assertion: Assertion,
  context: EvaluationContext,
): string[] {
  switch (assertion.kind) {
    case 'record_exists':
    case 'record_absent': {
      const snapshot = snapshotFor(context, assertion.state);
      const selection = selectRecords(snapshot, assertion.selector);
      if (selection.records.length === 0) {
        return stable([`state:${assertion.state}.${assertion.selector.collection}`]);
      }
      return stable(
        selection.records.map((record) =>
          stateRef(assertion.state, assertion.selector.collection, record.id),
        ),
      );
    }

    case 'record_field_equals':
    case 'record_money_equals':
    case 'record_array_contains_exact': {
      const snapshot = snapshotFor(context, assertion.state);
      const selection = selectRecords(snapshot, assertion.selector);
      if (selection.records.length === 0) {
        return stable([`state:${assertion.state}.${assertion.selector.collection}`]);
      }
      return stable(
        selection.records.map((record) =>
          stateRef(assertion.state, assertion.selector.collection, record.id, assertion.field),
        ),
      );
    }

    case 'record_field_equals_selected_record_id': {
      const left = selectRecords(snapshotFor(context, assertion.leftState), assertion.leftSelector);
      const right = selectRecords(
        snapshotFor(context, assertion.rightState),
        assertion.rightSelector,
      );
      const refs = [
        ...left.records.map((record) =>
          stateRef(assertion.leftState, assertion.leftSelector.collection, record.id, assertion.leftField),
        ),
        ...right.records.map((record) =>
          stateRef(assertion.rightState, assertion.rightSelector.collection, record.id),
        ),
      ];
      return stable(
        refs.length > 0
          ? refs
          : [
              `state:${assertion.leftState}.${assertion.leftSelector.collection}`,
              `state:${assertion.rightState}.${assertion.rightSelector.collection}`,
            ],
      );
    }

    case 'event_order': {
      const earlier = firstMatchingEvent(context.trajectory, assertion.earlier);
      const later = firstMatchingEvent(context.trajectory, assertion.later);
      const refs: string[] = [];
      if (earlier !== undefined) refs.push(`event:${earlier.eventId}`);
      if (later !== undefined) refs.push(`event:${later.eventId}`);
      // With neither event present there is nothing to point at but the trace.
      return stable(refs.length > 0 ? refs : ['trajectory']);
    }

    case 'mutations_limited_to': {
      const refs = [`state_diff:${assertion.collection}`];
      for (const allowed of assertion.allowedRecords) {
        if (allowed.kind === 'literal_id') {
          refs.push(stateRef('final', assertion.collection, allowed.id));
          continue;
        }
        const selection = selectRecords(
          snapshotFor(context, allowed.state),
          allowed.selector,
        );
        for (const record of selection.records) {
          refs.push(stateRef(allowed.state, assertion.collection, record.id));
        }
      }
      // Offending records are cited too, so a violation points at what changed.
      for (const change of changesInCollection(
        diffSnapshots(context.initialState, context.finalState),
        assertion.collection,
      )) {
        refs.push(stateRef('final', assertion.collection, change.recordId));
      }
      return stable(refs);
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
      return stable([
        `state_diff:${assertion.collection}`,
        ...relevant.map((change) => stateRef('final', assertion.collection, change.recordId)),
      ]);
    }
  }
}
