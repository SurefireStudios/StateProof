import { z } from 'zod';
import { IsoTimestampSchema, NonEmptyStringSchema, SchemaVersionSchema } from '../common';
import { RequirementIdSchema, TaskContractSchema } from './contract';
import { StateSnapshotSchema } from './state';
import { TaskSpecSchema } from './task';
import { ToolRegistrySchema } from './tool';
import { TrajectorySchema } from './trace';
import { GoldVerdictSchema } from './verdict';

/**
 * Dataset prefix, task template letter, case number. `PB-` is the Core-12
 * suite; `PBH-` is the adversarial Hard-12 suite.
 */
export const CaseIdSchema = z
  .string()
  .regex(/^PBH?-[A-Z]\d{2}$/, 'case ids look like "PB-A03" or "PBH-A03"');

export const SplitSchema = z.enum(['development', 'locked']);
export type Split = z.infer<typeof SplitSchema>;

/**
 * Everything an evaluator (baseline or StateProof) is allowed to see.
 * This type intentionally has no field that could carry gold data.
 */
export const AgentVisibleCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    task: TaskSpecSchema,
    toolRegistry: ToolRegistrySchema,
    initialState: StateSnapshotSchema,
    finalState: StateSnapshotSchema,
    trajectory: TrajectorySchema,
    finalResponse: NonEmptyStringSchema,
  })
  .strict();

export type AgentVisibleCase = z.infer<typeof AgentVisibleCaseSchema>;

/** Human-only. Never loaded by the agent input loader. */
export const CaseMetadataSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    caseId: CaseIdSchema,
    split: SplitSchema,
    goldLabel: z.enum(['valid', 'invalid']),
    failureMode: NonEmptyStringSchema.nullable(),
    failureDescription: NonEmptyStringSchema.nullable(),
    isolatedFailureRequirementId: RequirementIdSchema.nullable(),
    /** Multi-fault cases require explicit approval before they may be used. */
    multiFault: z.boolean(),
    /**
     * Every must-pass requirement this case is designed to violate. Single-fault
     * cases leave it empty and use `isolatedFailureRequirementId` instead;
     * multi-fault cases list all of them.
     */
    failedRequirementIds: z.array(RequirementIdSchema).default([]),
    approvedForUse: z.boolean(),
    reviewedBy: NonEmptyStringSchema,
    reviewedAt: IsoTimestampSchema,
    notes: z.array(NonEmptyStringSchema),
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (metadata.goldLabel === 'invalid') {
      if (metadata.failureMode === null || metadata.failureDescription === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failureMode'],
          message: 'invalid cases must describe their failure mode',
        });
      }
      if (!metadata.multiFault && metadata.isolatedFailureRequirementId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['isolatedFailureRequirementId'],
          message: 'single-fault invalid cases must name the violated requirement',
        });
      }
      if (metadata.multiFault && metadata.failedRequirementIds.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failedRequirementIds'],
          message: 'multi-fault invalid cases must list every violated requirement',
        });
      }
    }
    if (metadata.goldLabel === 'valid') {
      if (metadata.failureMode !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failureMode'],
          message: 'valid cases must not declare a failure mode',
        });
      }
      if (metadata.failedRequirementIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failedRequirementIds'],
          message: 'valid cases must not declare failed requirements',
        });
      }
    }
  });

export type CaseMetadata = z.infer<typeof CaseMetadataSchema>;

/** The full case, assembled only by fixture validation and scoring code. */
export const BenchmarkCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    agentVisible: AgentVisibleCaseSchema,
    goldContract: TaskContractSchema,
    goldVerdict: GoldVerdictSchema,
    metadata: CaseMetadataSchema,
  })
  .strict();

export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export const SplitManifestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    split: SplitSchema,
    description: NonEmptyStringSchema,
    caseIds: z.array(CaseIdSchema),
  })
  .strict();

export type SplitManifest = z.infer<typeof SplitManifestSchema>;
