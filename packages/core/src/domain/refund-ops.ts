import { z } from 'zod';
import { EmailAddressSchema, IsoTimestampSchema, MoneySchema, NonEmptyStringSchema } from '../common';
import type { StateSnapshot } from '../schema/state';

/**
 * The synthetic refund-operations sandbox. The state model itself is generic;
 * this module gives each collection a concrete field shape so fixtures cannot
 * drift, and gives the (future) Contract Agent a domain schema to reason over.
 */
export const REFUND_OPS_DOMAIN = 'refund-operations';

export const OrderFieldsSchema = z
  .object({
    customerName: NonEmptyStringSchema,
    customerEmail: EmailAddressSchema,
    status: z.enum(['processing', 'delivered', 'refunded', 'cancelled']),
    total: MoneySchema,
    refundedTotal: MoneySchema,
    placedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const RefundFieldsSchema = z
  .object({
    orderId: NonEmptyStringSchema,
    amount: MoneySchema,
    status: z.enum(['pending', 'succeeded', 'failed']),
    reason: NonEmptyStringSchema,
    approvalReference: NonEmptyStringSchema.nullable(),
    executedBy: NonEmptyStringSchema,
    executedAt: IsoTimestampSchema,
  })
  .strict();

export const EmailFieldsSchema = z
  .object({
    to: EmailAddressSchema,
    from: EmailAddressSchema,
    subject: NonEmptyStringSchema,
    body: NonEmptyStringSchema,
    relatedOrderId: NonEmptyStringSchema.nullable(),
    /** The refund this message is a receipt for, when it is one. */
    refundId: NonEmptyStringSchema.nullable(),
    /** `draft` is deliberately distinct from `sent`: a drafted receipt is not a sent receipt. */
    status: z.enum(['draft', 'queued', 'sent', 'failed']),
    sentAt: IsoTimestampSchema.nullable(),
  })
  .strict();

export const REFUND_OPS_COLLECTIONS = {
  orders: OrderFieldsSchema,
  refunds: RefundFieldsSchema,
  emails: EmailFieldsSchema,
} as const;

export type RefundOpsCollection = keyof typeof REFUND_OPS_COLLECTIONS;

/**
 * Which collections each write tool is allowed to change. Fixture validation
 * uses this to check that the final state is explainable by the successful
 * write events in the trajectory, rather than having been hand-edited.
 * `refund.execute` also settles the order it refunds.
 */
export const REFUND_OPS_WRITE_EFFECTS: Readonly<Record<string, readonly RefundOpsCollection[]>> = {
  'refund.execute': ['refunds', 'orders'],
  'orders.update': ['orders'],
  'email.send': ['emails'],
  'approval.request': [],
};

export interface DomainValidationIssue {
  readonly collection: string;
  readonly recordId: string;
  readonly message: string;
}

/** Validates every record of a snapshot against its collection field schema. */
export function validateRefundOpsSnapshot(snapshot: StateSnapshot): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const knownCollections = new Set<string>(Object.keys(REFUND_OPS_COLLECTIONS));

  for (const [collection, records] of Object.entries(snapshot.collections)) {
    if (!knownCollections.has(collection)) {
      issues.push({
        collection,
        recordId: '*',
        message: `collection "${collection}" is not part of the ${REFUND_OPS_DOMAIN} domain`,
      });
      continue;
    }
    const fieldSchema = REFUND_OPS_COLLECTIONS[collection as RefundOpsCollection];
    for (const record of records) {
      const parsed = fieldSchema.safeParse(record.fields);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            collection,
            recordId: record.id,
            message: `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          });
        }
      }
    }
  }
  return issues;
}
