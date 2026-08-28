import { z } from 'zod';
import { IsoTimestampSchema, NonEmptyStringSchema, SchemaVersionSchema } from '../common';

/**
 * The task as the target agent received it. Agent-visible.
 * Requirements are deliberately expressed only in `instruction`: the Contract
 * Agent must derive them from natural language, never from structured hints.
 */
export const TaskSpecSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    taskId: NonEmptyStringSchema,
    domain: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    instruction: NonEmptyStringSchema,
    issuedBy: NonEmptyStringSchema,
    issuedAt: IsoTimestampSchema,
  })
  .strict();

export type TaskSpec = z.infer<typeof TaskSpecSchema>;
