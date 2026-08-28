import { OverallVerdictSchema } from '@stateproof/core';
import { RawAttemptSchema } from '@stateproof/model-provider';
import { z } from 'zod';

/** The structured output the baseline evaluator must produce. */
export const BaselinePredictionSchema = z
  .object({
    verdict: OverallVerdictSchema,
    /** Descriptive only; never used in the primary metric. */
    confidence: z.number().min(0).max(1),
    summary: z.string().min(1),
    evidence: z.array(
      z
        .object({
          claim: z.string().min(1),
          source: z.string().min(1),
          finding: z.string().min(1),
        })
        .strict(),
    ),
    unresolved: z.array(z.string().min(1)),
  })
  .strict();

export type BaselinePrediction = z.infer<typeof BaselinePredictionSchema>;

/**
 * The prediction-phase artifact for one case. It carries no gold field by
 * construction: gold is not loaded until this file has been written.
 */
export const BaselineCasePredictionSchema = z
  .object({
    caseId: z.string().min(1),
    /** Null when even the repair attempt failed to produce valid output. */
    prediction: BaselinePredictionSchema.nullable(),
    parseAttempts: z.number().int().positive(),
    parseErrors: z.array(z.string()),
    runtimeMs: z.number().int().nonnegative(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    rawResponsePaths: z.array(z.string()),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type BaselineCasePrediction = z.infer<typeof BaselineCasePredictionSchema>;

export const BaselinePredictionFileSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    runId: z.string().min(1),
    system: z.literal('baseline'),
    split: z.enum(['development', 'locked']),
    predictions: z.array(BaselineCasePredictionSchema).min(1),
  })
  .strict();

export type BaselinePredictionFile = z.infer<typeof BaselinePredictionFileSchema>;

export { RawAttemptSchema };
