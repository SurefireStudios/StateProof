import { z } from 'zod';
import { JsonObjectSchema, JsonValueSchema } from '../json';
import { IsoTimestampSchema, NonEmptyStringSchema } from '../common';
import { ToolNameSchema } from './tool';

const TraceEventBase = {
  eventId: NonEmptyStringSchema,
  /** 1-based, strictly increasing. Ordering assertions use `seq`, never timestamps. */
  seq: z.number().int().positive(),
  timestamp: IsoTimestampSchema,
};

export const AgentMessageEventSchema = z
  .object({
    ...TraceEventBase,
    type: z.literal('agent_message'),
    role: z.enum(['assistant', 'user', 'system']),
    content: NonEmptyStringSchema,
  })
  .strict();

export const ToolCallEventSchema = z
  .object({
    ...TraceEventBase,
    type: z.literal('tool_call'),
    callId: NonEmptyStringSchema,
    toolName: ToolNameSchema,
    arguments: JsonObjectSchema,
  })
  .strict();

export const ToolResultEventSchema = z
  .object({
    ...TraceEventBase,
    type: z.literal('tool_result'),
    callId: NonEmptyStringSchema,
    toolName: ToolNameSchema,
    status: z.enum(['ok', 'error']),
    result: JsonValueSchema,
  })
  .strict();

/**
 * Human approval is a scoped trace event, never a sandbox write. `scope`
 * ("refund:ORD-1042") is what makes an approval checkable against the
 * protected action it is supposed to authorise.
 */
export const HumanApprovalEventSchema = z
  .object({
    ...TraceEventBase,
    type: z.literal('human_approval'),
    approvalId: NonEmptyStringSchema,
    scope: NonEmptyStringSchema,
    approver: NonEmptyStringSchema,
    decision: z.enum(['approved', 'rejected']),
    note: z.string().optional(),
  })
  .strict();

export const TraceEventSchema = z.discriminatedUnion('type', [
  AgentMessageEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  HumanApprovalEventSchema,
]);

export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type HumanApprovalEvent = z.infer<typeof HumanApprovalEventSchema>;
export type TraceEventType = TraceEvent['type'];

export const TrajectorySchema = z
  .array(TraceEventSchema)
  .min(1)
  .superRefine((events, ctx) => {
    const seenEventIds = new Set<string>();
    let previousSeq = 0;
    let previousTimestamp = '';
    for (const [index, event] of events.entries()) {
      if (seenEventIds.has(event.eventId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'eventId'],
          message: `duplicate eventId "${event.eventId}"`,
        });
      }
      seenEventIds.add(event.eventId);

      if (event.seq !== previousSeq + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'seq'],
          message: `seq must start at 1 and increase by 1; expected ${previousSeq + 1}, received ${event.seq}`,
        });
      }
      previousSeq = event.seq;

      if (previousTimestamp !== '' && event.timestamp < previousTimestamp) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'timestamp'],
          message: `timestamp ${event.timestamp} is earlier than the preceding event (${previousTimestamp})`,
        });
      }
      previousTimestamp = event.timestamp;
    }
  });

export type Trajectory = z.infer<typeof TrajectorySchema>;
