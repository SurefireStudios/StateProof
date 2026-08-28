import { z } from 'zod';
import { JsonValueSchema } from '../json';
import { IsoTimestampSchema, MoneySchema, NonEmptyStringSchema, SchemaVersionSchema } from '../common';
import { SnapshotLabelSchema } from './state';
import { ToolNameSchema } from './tool';

/** Where a piece of evidence may be read from. All sources are read-only. */
export const EvidenceSourceSchema = z.enum([
  'task',
  'tool_registry',
  'initial_state',
  'final_state',
  'trajectory',
  'final_response',
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/** `field` is a dotted path into a record's fields; the literal `id` selects the record id. */
export const FieldMatchSchema = z
  .object({
    field: NonEmptyStringSchema,
    equals: JsonValueSchema,
  })
  .strict();
export type FieldMatch = z.infer<typeof FieldMatchSchema>;

export const RecordSelectorSchema = z
  .object({
    collection: NonEmptyStringSchema,
    where: z.array(FieldMatchSchema).min(1),
  })
  .strict();
export type RecordSelector = z.infer<typeof RecordSelectorSchema>;

export const EventSelectorSchema = z
  .object({
    eventType: z.enum(['agent_message', 'tool_call', 'tool_result', 'human_approval']),
    toolName: ToolNameSchema.optional(),
    scope: NonEmptyStringSchema.optional(),
    decision: z.enum(['approved', 'rejected']).optional(),
    status: z.enum(['ok', 'error']).optional(),
    argumentMatches: z.array(FieldMatchSchema).optional(),
  })
  .strict();
export type EventSelector = z.infer<typeof EventSelectorSchema>;

const StateRefSchema = SnapshotLabelSchema.default('final');

/**
 * The deterministic assertion vocabulary. These cover exactly the check types
 * the core benchmark needs: equality, existence/absence, exact numeric value,
 * exact recipient, event ordering, prohibited record creation, and unrelated
 * mutation. Anything outside this vocabulary is left to human/model judgement
 * and must be declared with `assertion: null`.
 */
export const AssertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('record_exists'), state: StateRefSchema, selector: RecordSelectorSchema }).strict(),
  z.object({ kind: z.literal('record_absent'), state: StateRefSchema, selector: RecordSelectorSchema }).strict(),
  z
    .object({
      kind: z.literal('record_field_equals'),
      state: StateRefSchema,
      selector: RecordSelectorSchema,
      field: NonEmptyStringSchema,
      expected: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('record_money_equals'),
      state: StateRefSchema,
      selector: RecordSelectorSchema,
      field: NonEmptyStringSchema,
      expected: MoneySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('event_order'),
      earlier: EventSelectorSchema,
      later: EventSelectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('no_new_records'),
      collection: NonEmptyStringSchema,
      allowedRecordIds: z.array(NonEmptyStringSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('no_unrelated_mutations'),
      collection: NonEmptyStringSchema,
      allowedRecordIds: z.array(NonEmptyStringSchema),
    })
    .strict(),
]);

export type Assertion = z.infer<typeof AssertionSchema>;
export type AssertionKind = Assertion['kind'];

export const RequirementCategorySchema = z.enum([
  'outcome',
  'process',
  'scope',
  'prohibition',
  'quality',
]);
export type RequirementCategory = z.infer<typeof RequirementCategorySchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Upper-case, hyphen-separated, stable across runs. Wide enough to hold both
 * the canonical gold ids (`A-PROC-01`) and ids a Contract Agent compiles for
 * itself (`REQ-001-REFUND-EXECUTED`).
 */
export const RequirementIdSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+){1,3}$/, 'requirement ids look like "A-PROC-01"');

export const ContractRequirementSchema = z
  .object({
    requirementId: RequirementIdSchema,
    category: RequirementCategorySchema,
    description: NonEmptyStringSchema,
    /**
     * Conjunction: the requirement holds only when every assertion holds. An
     * empty list means "not machine-checkable" and can never be auto-verified.
     */
    assertions: z.array(AssertionSchema),
    evidence: z
      .object({
        sources: z.array(EvidenceSourceSchema).min(1),
        strategy: NonEmptyStringSchema,
      })
      .strict(),
    severity: SeveritySchema,
    mustPass: z.boolean(),
    ambiguities: z.array(NonEmptyStringSchema),
  })
  .strict();

export type ContractRequirement = z.infer<typeof ContractRequirementSchema>;

/** Output of the (future) Contract Agent, and the shape of every gold contract. */
export const TaskContractSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    contractId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    caseId: NonEmptyStringSchema.optional(),
    compiledBy: z.enum(['human', 'contract_agent']),
    compiledAt: IsoTimestampSchema,
    requirements: z.array(ContractRequirementSchema).min(1),
    notes: z.array(NonEmptyStringSchema),
  })
  .strict()
  .superRefine((contract, ctx) => {
    const seen = new Set<string>();
    for (const [index, requirement] of contract.requirements.entries()) {
      if (seen.has(requirement.requirementId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements', index, 'requirementId'],
          message: `duplicate requirementId "${requirement.requirementId}"`,
        });
      }
      seen.add(requirement.requirementId);
    }
    if (!contract.requirements.some((requirement) => requirement.mustPass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requirements'],
        message: 'a contract must contain at least one must-pass requirement',
      });
    }
  });

export type TaskContract = z.infer<typeof TaskContractSchema>;
