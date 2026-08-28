import { z } from 'zod';
import { JsonObjectSchema } from '../json';
import { IsoTimestampSchema, NonEmptyStringSchema, SchemaVersionSchema } from '../common';

/**
 * A sandbox record. The model is deliberately generic (collection -> records)
 * so state diffing and "no unrelated mutation" checks stay domain independent;
 * per-domain field shapes are validated separately (see src/domain).
 */
export const StateRecordSchema = z
  .object({
    id: NonEmptyStringSchema,
    fields: JsonObjectSchema,
  })
  .strict();

export type StateRecord = z.infer<typeof StateRecordSchema>;

export const SnapshotLabelSchema = z.enum(['initial', 'final']);
export type SnapshotLabel = z.infer<typeof SnapshotLabelSchema>;

export const StateSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    snapshotId: NonEmptyStringSchema,
    label: SnapshotLabelSchema,
    capturedAt: IsoTimestampSchema,
    collections: z.record(z.array(StateRecordSchema)),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    for (const [collection, records] of Object.entries(snapshot.collections)) {
      const seen = new Set<string>();
      for (const [index, record] of records.entries()) {
        if (seen.has(record.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['collections', collection, index, 'id'],
            message: `duplicate record id "${record.id}" in collection "${collection}"`,
          });
        }
        seen.add(record.id);
      }
    }
  });

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export function getCollection(snapshot: StateSnapshot, collection: string): StateRecord[] | undefined {
  return snapshot.collections[collection];
}
