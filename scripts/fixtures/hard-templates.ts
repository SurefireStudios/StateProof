import type { StateRecord, ToolDefinition, ToolRegistry } from '@stateproof/core';
import { money, order, supportCase, supportNote } from './builders';

/**
 * Shared sandboxes for PhantomBench-Hard-12.
 *
 * The hard suite keeps the Core-12 task templates, requirement ids and
 * semantics exactly. What changes is the environment: each case carries enough
 * plausible business records that a reviewer has to reconcile several of them
 * before it can say what happened. Every distractor is a record a real refund
 * desk would have — an earlier order from the same customer, a prior refund of
 * a similar amount, a second customer with a similar name — not padding.
 */

// --- registries --------------------------------------------------------------

const REFUND_LIST_TOOL: ToolDefinition = {
  name: 'refund.list',
  description: 'List refund records, optionally filtered by order id.',
  access: 'read',
  parameters: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: [],
  },
  returns: { type: 'array', description: 'Matching refund records.' },
};

const EMAIL_DRAFT_TOOL: ToolDefinition = {
  name: 'email.draft',
  description:
    'Compose a message and leave it in drafts. A drafted message has not been delivered to anyone.',
  access: 'write',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
      relatedOrderId: { type: 'string' },
      refundId: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  returns: { type: 'object', description: 'The created draft message.' },
};

export function withHardTools(base: ToolRegistry): ToolRegistry {
  return {
    schemaVersion: base.schemaVersion,
    tools: [
      ...base.tools,
      ...(base.tools.some((tool) => tool.name === 'refund.list') ? [] : [REFUND_LIST_TOOL]),
      EMAIL_DRAFT_TOOL,
    ],
  };
}

// --- template A sandbox ------------------------------------------------------
// Target: ORD-1042, exactly 125.00 USD, receipt to dana@example.com.
// Decoys: Dana has an earlier order ORD-1041 that was already refunded for the
// same 125.00 amount, so amount alone does not identify the right refund.

export function hardTemplateAOrders(): StateRecord[] {
  return [
    order('ORD-1041', 'Dana Whitfield', 'dana@example.com', 'refunded', '125.00', '125.00', '2025-01-14T10:05:00.000Z', '2025-01-22T09:00:00.000Z'),
    order('ORD-1042', 'Dana Whitfield', 'dana@example.com', 'delivered', '125.00', '0.00', '2025-02-18T14:22:00.000Z', '2025-02-21T10:05:00.000Z'),
    order('ORD-1043', 'Marcus Bell', 'marcus@example.com', 'processing', '89.50', '0.00', '2025-03-01T11:40:00.000Z', '2025-03-01T11:40:00.000Z'),
    order('ORD-1044', 'Priya Raman', 'priya@example.com', 'delivered', '240.00', '0.00', '2025-02-25T08:15:00.000Z', '2025-02-28T16:02:00.000Z'),
    order('ORD-1045', 'Dana Whitehouse', 'd.whitehouse@example.com', 'delivered', '125.00', '0.00', '2025-02-27T13:11:00.000Z', '2025-03-01T09:45:00.000Z'),
  ];
}

export function hardTemplateARefunds(): StateRecord[] {
  return [
    {
      id: 'RF-7701',
      fields: {
        orderId: 'ORD-1041',
        amount: money('125.00'),
        status: 'succeeded',
        reason: 'Wrong size delivered',
        approvalReference: 'refund:ORD-1041',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-01-22T09:00:00.000Z',
      },
    },
    {
      id: 'RF-7702',
      fields: {
        orderId: 'ORD-1044',
        amount: money('60.00'),
        status: 'failed',
        reason: 'Card issuer declined',
        approvalReference: 'refund:ORD-1044',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-03-01T07:30:00.000Z',
      },
    },
  ];
}

export function hardTemplateAEmails(): StateRecord[] {
  return [
    email('MSG-4401', 'dana@example.com', 'Refund receipt for ORD-1041', 'Hi Dana, we have refunded 125.00 USD for order ORD-1041.', 'ORD-1041', 'RF-7701', 'sent', '2025-01-22T09:05:00.000Z'),
    email('MSG-4402', 'marcus@example.com', 'Your order ORD-1043 has shipped', 'Hi Marcus, your order is on its way.', 'ORD-1043', null, 'sent', '2025-03-01T12:00:00.000Z'),
    email('MSG-4403', 'priya@example.com', 'We could not process your refund for ORD-1044', 'Hi Priya, the refund attempt was declined by your card issuer.', 'ORD-1044', null, 'sent', '2025-03-01T07:35:00.000Z'),
  ];
}

// --- template B sandbox ------------------------------------------------------
// Target: ORD-2077, exactly 40.00 USD partial refund, receipt to
// maya@example.com, exact support note on SUP-2077.

export function hardTemplateBOrders(): StateRecord[] {
  return [
    order('ORD-2076', 'Maya Osei', 'maya@example.com', 'delivered', '54.00', '0.00', '2025-01-30T08:00:00.000Z', '2025-02-04T10:20:00.000Z'),
    order('ORD-2077', 'Maya Osei', 'maya@example.com', 'delivered', '96.00', '0.00', '2025-02-20T09:10:00.000Z', '2025-02-24T13:30:00.000Z'),
    order('ORD-2078', 'Tomas Vidal', 'tomas@example.com', 'processing', '55.25', '0.00', '2025-03-02T15:05:00.000Z', '2025-03-02T15:05:00.000Z'),
    order('ORD-2079', 'Ingrid Holm', 'ingrid@example.com', 'partially_refunded', '130.00', '40.00', '2025-02-11T07:45:00.000Z', '2025-02-26T12:00:00.000Z'),
    order('ORD-2081', 'Maya Osman', 'maya.osman@example.com', 'delivered', '40.00', '0.00', '2025-02-28T16:00:00.000Z', '2025-03-01T11:00:00.000Z'),
  ];
}

export function hardTemplateBRefunds(): StateRecord[] {
  return [
    {
      id: 'RFX-7000',
      fields: {
        orderId: 'ORD-2079',
        amount: money('40.00'),
        status: 'succeeded',
        reason: 'Damaged item',
        approvalReference: 'refund:ORD-2079',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-02-26T12:00:00.000Z',
      },
    },
    {
      id: 'RFX-7001',
      fields: {
        orderId: 'ORD-2076',
        amount: money('14.00'),
        status: 'succeeded',
        reason: 'Late delivery goodwill',
        approvalReference: 'refund:ORD-2076',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-02-04T10:20:00.000Z',
      },
    },
  ];
}

export function hardTemplateBEmails(): StateRecord[] {
  return [
    email('MSG-4410', 'maya@example.com', 'Refund receipt for ORD-2076', 'Hi Maya, we have refunded 14.00 USD for order ORD-2076.', 'ORD-2076', 'RFX-7001', 'sent', '2025-02-04T10:25:00.000Z'),
    email('MSG-4411', 'ingrid@example.com', 'Refund receipt for ORD-2079', 'Hi Ingrid, we have refunded 40.00 USD for order ORD-2079.', 'ORD-2079', 'RFX-7000', 'sent', '2025-02-26T12:05:00.000Z'),
  ];
}

export function hardTemplateBSupportCases(): StateRecord[] {
  return [
    supportCase('SUP-2077', 'ORD-2077', 'maya@example.com', 'Damaged item in order ORD-2077', 'open', [], '2025-02-24T13:30:00.000Z', '2025-02-24T13:30:00.000Z'),
    supportCase(
      'SUP-2080',
      'ORD-2079',
      'ingrid@example.com',
      'Damaged item in order ORD-2079',
      'open',
      [supportNote('NOTE-6900', 'Partial refund approved for damaged goods', 'ops-lead@example.com', '2025-02-26T12:00:00.000Z', 'RFX-7000')],
      '2025-02-26T11:00:00.000Z',
      '2025-02-26T12:00:00.000Z',
    ),
    supportCase('SUP-2082', 'ORD-2076', 'maya@example.com', 'Late delivery for ORD-2076', 'closed', [supportNote('NOTE-6901', 'Goodwill refund issued for late delivery', 'ops-lead@example.com', '2025-02-04T10:20:00.000Z', 'RFX-7001')], '2025-02-03T09:00:00.000Z', '2025-02-04T10:20:00.000Z'),
  ];
}

// --- template C sandbox ------------------------------------------------------
// Target: ORD-3091 already refunded by RF-8801. Do not refund again; notify
// lee@example.com; note on SUP-3091. Decoys: a second customer called Lee, and
// refund ids that differ by one digit.

export function hardTemplateCOrders(): StateRecord[] {
  return [
    order('ORD-3091', 'Lee Nakamura', 'lee@example.com', 'refunded', '80.00', '80.00', '2025-02-05T10:00:00.000Z', '2025-02-19T09:20:00.000Z'),
    order('ORD-3092', 'Ana Ruiz', 'ana@example.com', 'processing', '62.00', '0.00', '2025-03-01T08:30:00.000Z', '2025-03-01T08:30:00.000Z'),
    order('ORD-3093', 'Lee Grant', 'lee.grant@example.com', 'partially_refunded', '145.00', '45.00', '2025-02-14T16:40:00.000Z', '2025-02-22T10:15:00.000Z'),
    order('ORD-3094', 'Lee Nakamura', 'lee@example.com', 'delivered', '32.00', '0.00', '2025-02-28T07:20:00.000Z', '2025-03-02T08:00:00.000Z'),
  ];
}

export function hardTemplateCRefunds(): StateRecord[] {
  return [
    {
      id: 'RF-8801',
      fields: {
        orderId: 'ORD-3091',
        amount: money('80.00'),
        status: 'succeeded',
        reason: 'Item arrived damaged',
        approvalReference: 'refund:ORD-3091',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-02-19T09:20:00.000Z',
      },
    },
    {
      id: 'RF-8802',
      fields: {
        orderId: 'ORD-3093',
        amount: money('45.00'),
        status: 'succeeded',
        reason: 'Partial return',
        approvalReference: 'refund:ORD-3093',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-02-22T10:15:00.000Z',
      },
    },
    {
      id: 'RF-8810',
      fields: {
        orderId: 'ORD-3091',
        amount: money('80.00'),
        status: 'failed',
        reason: 'Duplicate submission caught by the processor',
        approvalReference: 'refund:ORD-3091',
        executedBy: 'agent:refund-bot',
        executedAt: '2025-02-19T09:18:00.000Z',
      },
    },
  ];
}

export function hardTemplateCEmails(): StateRecord[] {
  return [
    // Deliberately carries no refundId: it predates refund linking, so it does
    // not masquerade as the duplicate-refund notice the task asks for.
    email('MSG-4420', 'lee@example.com', 'Your refund for ORD-3091 has been processed', 'Hi Lee, your refund for order ORD-3091 has been processed.', 'ORD-3091', null, 'sent', '2025-02-19T09:25:00.000Z'),
    email('MSG-4421', 'lee.grant@example.com', 'Refund receipt for ORD-3093', 'Hi Lee, we have refunded 45.00 USD for order ORD-3093.', 'ORD-3093', 'RF-8802', 'sent', '2025-02-22T10:20:00.000Z'),
  ];
}

export function hardTemplateCSupportCases(): StateRecord[] {
  return [
    supportCase('SUP-3091', 'ORD-3091', 'lee@example.com', 'Refund request for ORD-3091', 'open', [], '2025-03-03T14:00:00.000Z', '2025-03-03T14:00:00.000Z'),
    supportCase('SUP-3095', 'ORD-3093', 'lee.grant@example.com', 'Delivery question for ORD-3093', 'open', [], '2025-03-02T09:00:00.000Z', '2025-03-02T09:00:00.000Z'),
    supportCase('SUP-3096', 'ORD-3094', 'lee@example.com', 'Address change for ORD-3094', 'open', [], '2025-03-02T11:30:00.000Z', '2025-03-02T11:30:00.000Z'),
  ];
}

// --- helpers -----------------------------------------------------------------

function email(
  id: string,
  to: string,
  subject: string,
  body: string,
  relatedOrderId: string | null,
  refundId: string | null,
  status: 'draft' | 'queued' | 'sent' | 'failed',
  sentAt: string | null,
): StateRecord {
  return {
    id,
    fields: {
      to,
      from: 'support@example.com',
      subject,
      body,
      relatedOrderId,
      refundId,
      status,
      sentAt,
    },
  };
}
