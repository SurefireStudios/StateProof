import type { JsonObject } from '../json';
import type { StateRecord, StateSnapshot } from '../schema/state';
import { canonicalJson } from '../serialize/canonical';

export type ChangeKind = 'added' | 'removed' | 'modified';

export interface RecordChange {
  readonly collection: string;
  readonly recordId: string;
  readonly kind: ChangeKind;
  readonly changedFields: string[];
  readonly before: JsonObject | null;
  readonly after: JsonObject | null;
}

function indexById(records: readonly StateRecord[]): Map<string, StateRecord> {
  return new Map(records.map((record) => [record.id, record]));
}

function changedFieldNames(before: JsonObject, after: JsonObject): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const name of [...names].sort()) {
    const beforeValue = before[name];
    const afterValue = after[name];
    const beforeJson = beforeValue === undefined ? '<absent>' : canonicalJson(beforeValue);
    const afterJson = afterValue === undefined ? '<absent>' : canonicalJson(afterValue);
    if (beforeJson !== afterJson) changed.push(name);
  }
  return changed;
}

/** Deterministic, order-independent diff of two snapshots. */
export function diffSnapshots(initial: StateSnapshot, final: StateSnapshot): RecordChange[] {
  const collections = new Set([
    ...Object.keys(initial.collections),
    ...Object.keys(final.collections),
  ]);
  const changes: RecordChange[] = [];

  for (const collection of [...collections].sort()) {
    const before = indexById(initial.collections[collection] ?? []);
    const after = indexById(final.collections[collection] ?? []);
    const recordIds = new Set([...before.keys(), ...after.keys()]);

    for (const recordId of [...recordIds].sort()) {
      const beforeRecord = before.get(recordId);
      const afterRecord = after.get(recordId);

      if (beforeRecord !== undefined && afterRecord === undefined) {
        changes.push({
          collection,
          recordId,
          kind: 'removed',
          changedFields: Object.keys(beforeRecord.fields).sort(),
          before: beforeRecord.fields,
          after: null,
        });
      } else if (beforeRecord === undefined && afterRecord !== undefined) {
        changes.push({
          collection,
          recordId,
          kind: 'added',
          changedFields: Object.keys(afterRecord.fields).sort(),
          before: null,
          after: afterRecord.fields,
        });
      } else if (beforeRecord !== undefined && afterRecord !== undefined) {
        const changedFields = changedFieldNames(beforeRecord.fields, afterRecord.fields);
        if (changedFields.length > 0) {
          changes.push({
            collection,
            recordId,
            kind: 'modified',
            changedFields,
            before: beforeRecord.fields,
            after: afterRecord.fields,
          });
        }
      }
    }
  }
  return changes;
}

export function changesInCollection(changes: readonly RecordChange[], collection: string): RecordChange[] {
  return changes.filter((change) => change.collection === collection);
}
