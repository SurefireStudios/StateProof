import { z } from 'zod';
import { NonEmptyStringSchema, SchemaVersionSchema } from '../common';
import { RequirementIdSchema, SeveritySchema } from './contract';
import { EvidenceRecordSchema } from './evidence';

export const AssertionOutcomeSchema = z.enum(['satisfied', 'violated', 'indeterminate']);
export type AssertionOutcome = z.infer<typeof AssertionOutcomeSchema>;

export const RequirementStatusSchema = z.enum(['verified', 'disproven', 'insufficient_evidence']);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

/**
 * PASS  - every must-pass requirement is verified.
 * FAIL  - at least one must-pass requirement is disproven.
 * NEEDS_REVIEW - nothing disproven, but at least one must-pass requirement
 *                lacks sufficient evidence. Missing evidence never becomes PASS.
 */
export const OverallVerdictSchema = z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']);
export type OverallVerdict = z.infer<typeof OverallVerdictSchema>;

export const RequirementVerdictSchema = z
  .object({
    requirementId: RequirementIdSchema,
    status: RequirementStatusSchema,
    mustPass: z.boolean(),
    severity: SeveritySchema,
    assertionOutcome: AssertionOutcomeSchema.nullable(),
    rationale: NonEmptyStringSchema,
    evidenceIds: z.array(NonEmptyStringSchema),
  })
  .strict();

export type RequirementVerdict = z.infer<typeof RequirementVerdictSchema>;

export const RunVerdictSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    caseId: NonEmptyStringSchema,
    contractId: NonEmptyStringSchema,
    overall: OverallVerdictSchema,
    requirementVerdicts: z.array(RequirementVerdictSchema).min(1),
    evidence: z.array(EvidenceRecordSchema),
    summary: NonEmptyStringSchema,
  })
  .strict();

export type RunVerdict = z.infer<typeof RunVerdictSchema>;

/**
 * Human-authored expected result for a benchmark case. Gold data is never
 * shown to an agent; it only ever feeds fixture validation and scoring.
 */
export const GoldVerdictSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    caseId: NonEmptyStringSchema,
    overall: OverallVerdictSchema,
    requirementExpectations: z
      .array(
        z
          .object({
            requirementId: RequirementIdSchema,
            expectedStatus: RequirementStatusSchema,
            rationale: NonEmptyStringSchema,
          })
          .strict(),
      )
      .min(1),
    summary: NonEmptyStringSchema,
  })
  .strict();

export type GoldVerdict = z.infer<typeof GoldVerdictSchema>;
