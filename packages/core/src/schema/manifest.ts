import { z } from 'zod';
import { IsoTimestampSchema, NonEmptyStringSchema, SchemaVersionSchema } from '../common';
import { CaseIdSchema, SplitSchema } from './case';
import { RequirementIdSchema } from './contract';
import { OverallVerdictSchema, RequirementVerdictSchema, RequirementStatusSchema } from './verdict';

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex digest');

export const ModelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
  })
  .strict();

export type ModelUsage = z.infer<typeof ModelUsageSchema>;

/**
 * Recorded for every evaluation run so a headline number can always be traced
 * back to the exact code, prompts, dataset and model that produced it.
 * Unavailable fields are recorded as `null` rather than being invented.
 */
export const EvaluationRunManifestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: NonEmptyStringSchema,
    createdAt: IsoTimestampSchema,
    system: z.enum(['baseline', 'stateproof']),
    stage: NonEmptyStringSchema,
    mode: z.enum(['live', 'replay']),

    gitCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    /**
     * Whether the tracked source tree matched that commit when the run
     * started. Absent on manifests written before the clean-source rule
     * existed, which is exactly why it is optional rather than defaulted:
     * a historical run must not be able to claim a property nobody checked.
     */
    sourceTreeClean: z.boolean().optional(),
    /** Assertion vocabulary the contracts in this run were compiled against. */
    assertionSchemaVersion: NonEmptyStringSchema.optional(),
    /** Set when the run verified from a persisted contract bundle. */
    sourceContractRunId: NonEmptyStringSchema.nullable().optional(),
    runtimeVersion: NonEmptyStringSchema,
    packageLockHash: Sha256Schema.nullable(),

    datasetName: NonEmptyStringSchema,
    /**
     * Fingerprint of exactly what the model was shown. Written during the
     * prediction phase, which never opens a gold file.
     */
    agentVisibleDatasetHash: Sha256Schema,
    /**
     * Gold-inclusive dataset fingerprint. Null until the scoring phase fills
     * it in; the two are kept separate so they cannot be conflated.
     */
    datasetHash: Sha256Schema.nullable(),
    splits: z.array(SplitSchema).min(1),
    caseIds: z.array(CaseIdSchema).min(1),

    modelProvider: NonEmptyStringSchema.nullable(),
    modelId: NonEmptyStringSchema.nullable(),
    /** Temperature, max tokens, timeouts: whatever was actually configured. */
    modelConfiguration: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    maxRetries: z.number().int().nonnegative(),
    timeoutPolicy: NonEmptyStringSchema,

    promptFilePaths: z.array(NonEmptyStringSchema),
    /** sha256 of each prompt file, keyed by prompt path. */
    promptHashes: z.record(Sha256Schema),

    startedAt: IsoTimestampSchema,
    finishedAt: IsoTimestampSchema,
    wallClockMs: z.number().int().nonnegative(),

    modelUsage: ModelUsageSchema.nullable(),

    rawResponsePaths: z.array(NonEmptyStringSchema),
    trajectoryPaths: z.array(NonEmptyStringSchema),
    predictionPath: NonEmptyStringSchema.nullable(),
    reportPath: NonEmptyStringSchema.nullable(),

    notes: z.array(NonEmptyStringSchema),
  })
  .strict();

export type EvaluationRunManifest = z.infer<typeof EvaluationRunManifestSchema>;

/**
 * Per-case scored result. This is a report artifact, which is the only place
 * gold fields are allowed to appear; they must never reach an agent input.
 */
export const CaseResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: NonEmptyStringSchema,
    caseId: CaseIdSchema,
    goldVerdict: OverallVerdictSchema,
    predictedVerdict: OverallVerdictSchema,
    correct: z.boolean(),
    /** A gold-FAIL case predicted PASS: the most dangerous evaluator error. */
    unsafeFalseCompletion: z.boolean(),
    parseAttempts: z.number().int().positive(),
    runtimeMs: z.number().int().nonnegative(),
    modelUsage: ModelUsageSchema.nullable(),
    summary: NonEmptyStringSchema,
    requirementVerdicts: z.array(RequirementVerdictSchema),
    goldRequirementExpectations: z.array(
      z
        .object({
          requirementId: RequirementIdSchema,
          expectedStatus: RequirementStatusSchema,
        })
        .strict(),
    ),
    evidenceIds: z.array(NonEmptyStringSchema),
    artifactPaths: z.array(NonEmptyStringSchema),
  })
  .strict();

export type CaseResult = z.infer<typeof CaseResultSchema>;
