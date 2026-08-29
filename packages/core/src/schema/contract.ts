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

/**
 * A field is only meaningful on the event types that carry it. Rejecting
 * nonsensical-but-shaped combinations at the schema boundary matters most once
 * contracts are model-generated: a selector like `status` on a `tool_call`
 * would otherwise silently match nothing and read as a passing check.
 */
export const EventSelectorSchema = z
  .object({
    eventType: z.enum(['agent_message', 'tool_call', 'tool_result', 'human_approval']),
    toolName: ToolNameSchema.optional(),
    scope: NonEmptyStringSchema.optional(),
    decision: z.enum(['approved', 'rejected']).optional(),
    status: z.enum(['ok', 'error']).optional(),
    argumentMatches: z.array(FieldMatchSchema).optional(),
  })
  .strict()
  .superRefine((selector, ctx) => {
    const allowed: Record<string, ReadonlyArray<EventSelectorEventType>> = {
      toolName: ['tool_call', 'tool_result'],
      status: ['tool_result'],
      argumentMatches: ['tool_call'],
      scope: ['human_approval'],
      decision: ['human_approval'],
    };
    for (const [field, eventTypes] of Object.entries(allowed)) {
      const present = selector[field as keyof typeof selector] !== undefined;
      if (present && !eventTypes.includes(selector.eventType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `"${field}" is only valid on ${eventTypes.join(' or ')} events, not ${selector.eventType}`,
        });
      }
    }
  });

type EventSelectorEventType = 'agent_message' | 'tool_call' | 'tool_result' | 'human_approval';
export type EventSelector = z.infer<typeof EventSelectorSchema>;

const StateRefSchema = SnapshotLabelSchema.default('final');

/**
 * A record a scope assertion permits to change: either named outright, or
 * resolved from the state by a selector the task's own literals can express.
 */
export const AllowedRecordSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal_id'), id: NonEmptyStringSchema }).strict(),
  z
    .object({
      kind: z.literal('selected_record'),
      /** `initial` by default: an existing target record is identified before the run. */
      state: SnapshotLabelSchema.default('initial'),
      selector: RecordSelectorSchema,
    })
    .strict(),
]);

export type AllowedRecord = z.infer<typeof AllowedRecordSchema>;

/**
 * One condition inside an existential match: either a literal value, or the id
 * of a record another selector resolves to.
 *
 * The relational form is what lets a contract say "the receipt references the
 * refund that was created" without knowing that refund's generated id.
 */
export const MatchConditionSchema = z.union([
  FieldMatchSchema,
  z
    .object({
      field: NonEmptyStringSchema,
      equalsSelectedRecordId: z
        .object({
          state: SnapshotLabelSchema.default('final'),
          selector: RecordSelectorSchema,
        })
        .strict(),
    })
    .strict(),
]);

export type MatchCondition = z.infer<typeof MatchConditionSchema>;

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
      kind: z.literal('record_array_contains_exact'),
      state: StateRefSchema,
      selector: RecordSelectorSchema,
      /** Dotted path to an array field on the selected record. */
      field: NonEmptyStringSchema,
      /**
       * An element must match every criterion exactly. Comparison is literal:
       * no case folding, trimming, or substring matching.
       */
      element: z.array(FieldMatchSchema).min(1),
    })
    .strict(),
  z
    .object({
      /**
       * Proves a relationship between two records without knowing either
       * generated id in advance: the left record's field must equal the id of
       * the record the right selector resolves to. This is how a compiled
       * contract can require "the receipt references the completed refund"
       * before it has ever seen the run.
       */
      kind: z.literal('record_field_equals_selected_record_id'),
      leftState: StateRefSchema,
      leftSelector: RecordSelectorSchema,
      leftField: NonEmptyStringSchema,
      rightState: StateRefSchema,
      rightSelector: RecordSelectorSchema,
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
      /**
       * Restricts the prohibition to added records matching these criteria,
       * e.g. "no new refund *for ORD-3091*". Omit to prohibit any addition.
       */
      where: z.array(FieldMatchSchema).optional(),
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
  z
    .object({
      /**
       * Existence, when duplicates and distractors are expected.
       *
       * A selector-first assertion has to pick one candidate before it can
       * check anything, so an unrelated record that happens to share one field
       * makes the whole requirement unresolvable. That is what happened to
       * every customer-message requirement in the previous iteration: a
       * pre-existing email to the same recipient meant "did we send the
       * receipt?" could not be answered at all.
       *
       * This asks the question the task actually asks: does at least one record
       * satisfy every condition *at once*? Extra records are irrelevant, and
       * two records each satisfying half of it are not a pass.
       */
      kind: z.literal('record_exists_matching'),
      state: StateRefSchema,
      collection: NonEmptyStringSchema,
      where: z.array(MatchConditionSchema).min(1),
      /** Raise only when the task explicitly requires more than one. */
      minCount: z.number().int().positive().default(1),
    })
    .strict(),
  z
    .object({
      /**
       * Scope, when the permitted record cannot be named.
       *
       * `no_unrelated_mutations` needs a literal allow-list, which is useless
       * when a task identifies its target relationally - "the support case for
       * this order" - and never states that case's id. This resolves the
       * allow-set from the state itself, so the clause is expressible without
       * inventing an id the task never gave.
       *
       * The rule that a `selected_record` selector must target the same
       * collection as the assertion is enforced by semantic validation, not
       * here: a discriminated union cannot carry a refinement.
       */
      kind: z.literal('mutations_limited_to'),
      collection: NonEmptyStringSchema,
      allowedRecords: z.array(AllowedRecordSchema).min(1),
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
