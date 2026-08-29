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
    status: z.enum(['processing', 'delivered', 'partially_refunded', 'refunded', 'cancelled']),
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

/** One note appended to a support case. Notes are never edited or removed. */
export const SupportNoteSchema = z
  .object({
    noteId: NonEmptyStringSchema,
    text: NonEmptyStringSchema,
    author: NonEmptyStringSchema,
    addedAt: IsoTimestampSchema,
    /** Set when the note refers to a specific refund record. */
    relatedRefundId: NonEmptyStringSchema.nullable(),
  })
  .strict();

export type SupportNote = z.infer<typeof SupportNoteSchema>;

export const SupportCaseFieldsSchema = z
  .object({
    orderId: NonEmptyStringSchema,
    customerEmail: EmailAddressSchema,
    subject: NonEmptyStringSchema,
    status: z.enum(['open', 'pending', 'closed']),
    notes: z.array(SupportNoteSchema),
    openedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const REFUND_OPS_COLLECTIONS = {
  orders: OrderFieldsSchema,
  refunds: RefundFieldsSchema,
  emails: EmailFieldsSchema,
  support_cases: SupportCaseFieldsSchema,
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
  /** Composes a message without sending it: a drafted receipt is not a receipt. */
  'email.draft': ['emails'],
  'support.add_note': ['support_cases'],
  'support.update': ['support_cases'],
  /** Requests an approval; the approval itself is a trace event, not state. */
  'approval.request': [],
};

/** Constants the replay engine uses for fields the sandbox assigns itself. */
export const REFUND_OPS_ACTOR = 'agent:refund-bot';
export const REFUND_OPS_SUPPORT_MAILBOX = 'support@example.com';

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

/**
 * Cross-record integrity for a refund-operations snapshot.
 *
 * Schema validation proves each record is well shaped; this proves the records
 * agree with each other. A receipt that references a refund belonging to a
 * different order is individually valid and jointly nonsense.
 */
export function validateRefundOpsReferences(snapshot: StateSnapshot): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const orderIds = new Set((snapshot.collections['orders'] ?? []).map((entry) => entry.id));
  const refunds = snapshot.collections['refunds'] ?? [];
  const refundOrderById = new Map(
    refunds.map((entry) => [entry.id, entry.fields['orderId']] as const),
  );

  const flag = (collection: string, recordId: string, message: string): void => {
    issues.push({ collection, recordId, message });
  };

  for (const refund of refunds) {
    const orderId = refund.fields['orderId'];
    if (typeof orderId !== 'string' || !orderIds.has(orderId)) {
      flag('refunds', refund.id, `references order ${String(orderId)}, which does not exist`);
    }
  }

  for (const email of snapshot.collections['emails'] ?? []) {
    const relatedOrderId = email.fields['relatedOrderId'];
    const refundId = email.fields['refundId'];

    if (typeof relatedOrderId === 'string' && !orderIds.has(relatedOrderId)) {
      flag('emails', email.id, `references order ${relatedOrderId}, which does not exist`);
    }
    if (typeof refundId === 'string' && !refundOrderById.has(refundId)) {
      flag('emails', email.id, `references refund ${refundId}, which does not exist`);
    }
    // A receipt must not point at a refund for some other order.
    if (typeof refundId === 'string' && typeof relatedOrderId === 'string') {
      const refundOrderId = refundOrderById.get(refundId);
      if (refundOrderId !== undefined && refundOrderId !== relatedOrderId) {
        flag(
          'emails',
          email.id,
          `references refund ${refundId} (order ${String(refundOrderId)}) but is filed under order ${relatedOrderId}`,
        );
      }
    }
    if (email.fields['status'] === 'sent' && email.fields['sentAt'] === null) {
      flag('emails', email.id, 'has status "sent" but no sentAt timestamp');
    }
    if (email.fields['status'] !== 'sent' && email.fields['sentAt'] !== null) {
      flag('emails', email.id, `has a sentAt timestamp but status "${String(email.fields['status'])}"`);
    }
  }

  for (const supportCase of snapshot.collections['support_cases'] ?? []) {
    const orderId = supportCase.fields['orderId'];
    if (typeof orderId !== 'string' || !orderIds.has(orderId)) {
      flag('support_cases', supportCase.id, `references order ${String(orderId)}, which does not exist`);
    }
    const notes = supportCase.fields['notes'];
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      if (note === null || typeof note !== 'object' || Array.isArray(note)) continue;
      const relatedRefundId = note['relatedRefundId'];
      if (typeof relatedRefundId === 'string' && !refundOrderById.has(relatedRefundId)) {
        flag(
          'support_cases',
          supportCase.id,
          `note ${String(note['noteId'])} references refund ${relatedRefundId}, which does not exist`,
        );
      }
    }
  }

  return issues;
}

/**
 * A plain-JSON description of the sandbox, given to the Contract Agent so it
 * can write selectors against real collections and fields.
 *
 * It describes shape only. It contains no record, no id, and nothing about any
 * particular run.
 */
export const REFUND_OPS_DOMAIN_SCHEMA = {
  domain: REFUND_OPS_DOMAIN,
  money: {
    shape: { amount: 'decimal string with exactly two fraction digits', currency: 'ISO-4217 code' },
    note: 'Money is never a number. Compare with record_money_equals.',
  },
  collections: {
    orders: {
      id: 'order id, e.g. the identifier the task names',
      fields: {
        customerName: 'string',
        customerEmail: 'email address',
        status: 'processing | delivered | partially_refunded | refunded | cancelled',
        total: 'money',
        refundedTotal: 'money',
        placedAt: 'ISO-8601 UTC timestamp',
        updatedAt: 'ISO-8601 UTC timestamp',
      },
    },
    refunds: {
      id: 'refund id, generated when a refund is executed',
      fields: {
        orderId: 'order this refund belongs to',
        amount: 'money',
        status: 'pending | succeeded | failed',
        reason: 'string',
        approvalReference: 'string or null; an argument supplied by the caller, not proof of approval',
        executedBy: 'string',
        executedAt: 'ISO-8601 UTC timestamp',
      },
    },
    emails: {
      id: 'message id, generated when a message is created',
      fields: {
        to: 'email address',
        from: 'email address',
        subject: 'string',
        body: 'string',
        relatedOrderId: 'order id or null',
        refundId: 'refund id or null',
        status: 'draft | queued | sent | failed; a draft has not been delivered to anyone',
        sentAt: 'ISO-8601 UTC timestamp or null',
      },
    },
    support_cases: {
      id: 'support case id',
      fields: {
        orderId: 'order id',
        customerEmail: 'email address',
        subject: 'string',
        status: 'open | pending | closed',
        notes: 'array of { noteId, text, author, addedAt, relatedRefundId }; append-only',
        openedAt: 'ISO-8601 UTC timestamp',
        updatedAt: 'ISO-8601 UTC timestamp',
      },
    },
  },
  traceEvents: {
    agent_message: { role: 'assistant | user | system', content: 'string' },
    tool_call: { callId: 'string', toolName: 'string', arguments: 'object' },
    tool_result: { callId: 'string', toolName: 'string', status: 'ok | error', result: 'any' },
    human_approval: {
      approvalId: 'string',
      scope: 'string, e.g. refund:<orderId>',
      approver: 'string',
      decision: 'approved | rejected',
    },
  },
  ordering: 'Every event carries a 1-based seq. Ordering assertions compare seq, never timestamps.',
} as const;

/**
 * Which message fields carry which meaning, for the output-record lint.
 *
 * Derived from the same schema the Contract Agent is shown, so checking a
 * contract against it is a capability question ("did you use the
 * discriminators this domain offers?") and never a gold-data question.
 */
export const REFUND_OPS_MESSAGE_POLICY = {
  collection: 'emails',
  recipientField: 'to',
  statusField: 'status',
  sentValue: 'sent',
  orderField: 'relatedOrderId',
  refundField: 'refundId',
} as const;
