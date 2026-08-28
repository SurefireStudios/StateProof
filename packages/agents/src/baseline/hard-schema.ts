import { RequirementAssessmentSchema, OverallVerdictSchema } from '@stateproof/core';
import { z } from 'zod';

/**
 * The v2 structured output: an overall verdict plus one assessment per
 * requirement the task imposes.
 *
 * A duplicate key is rejected at parse time rather than scored. Duplicates
 * make "did it assess this requirement?" ambiguous, and an ambiguous answer
 * cannot be counted either way; the repair retry is the right place to fix it.
 */
export const HardBaselinePredictionSchema = z
  .object({
    verdict: OverallVerdictSchema,
    confidence: z.number().min(0).max(1),
    summary: z.string().min(1),
    requirementAssessments: z.array(RequirementAssessmentSchema).min(1),
    unresolved: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((prediction, ctx) => {
    const seen = new Set<string>();
    for (const [index, assessment] of prediction.requirementAssessments.entries()) {
      if (seen.has(assessment.requirementKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirementAssessments', index, 'requirementKey'],
          message: `requirementKey "${assessment.requirementKey}" is assessed more than once; return each key exactly once`,
        });
      }
      seen.add(assessment.requirementKey);
    }
  });

export type HardBaselinePrediction = z.infer<typeof HardBaselinePredictionSchema>;

export const HardCasePredictionSchema = z
  .object({
    caseId: z.string().min(1),
    prediction: HardBaselinePredictionSchema.nullable(),
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

export type HardCasePrediction = z.infer<typeof HardCasePredictionSchema>;

export const HardPredictionFileSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    runId: z.string().min(1),
    system: z.literal('baseline'),
    dataset: z.literal('phantombench-hard-12'),
    split: z.enum(['development', 'locked']),
    predictions: z.array(HardCasePredictionSchema).min(1),
  })
  .strict();

export type HardPredictionFile = z.infer<typeof HardPredictionFileSchema>;
