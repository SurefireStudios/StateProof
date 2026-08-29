import { z } from 'zod';

/**
 * The contract between the server and the browser.
 *
 * Every payload the client renders is described here, and every payload the
 * server accepts is parsed through here. The browser is treated as untrusted
 * input in both directions: it never receives a credential, a gold label, or a
 * filesystem path, and nothing it sends is used before it validates.
 */

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const EvidenceRefSchema = z
  .object({
    ref: z.string().min(1),
    /** DOM anchors the client can scroll to. Empty when nothing renders it. */
    targets: z.array(z.string().min(1)),
  })
  .strict();

export const RequirementViewSchema = z
  .object({
    requirementKey: z.string().min(1),
    description: z.string(),
    category: z.string(),
    status: VerdictSchema,
    reason: z.string(),
    verificationCoverage: z.enum(['complete', 'partial']),
    limitations: z.array(z.string()),
    evidence: z.array(EvidenceRefSchema),
  })
  .strict();

export type RequirementView = z.infer<typeof RequirementViewSchema>;

export const TimelineEventSchema = z
  .object({
    eventId: z.string().min(1),
    seq: z.number().int().positive(),
    type: z.string().min(1),
    summary: z.string(),
    kind: z.enum(['approval', 'write', 'error', 'message', 'result']),
    /** True when a requirement's evidence cited this event. */
    cited: z.boolean(),
  })
  .strict();

export const FieldChangeSchema = z
  .object({ field: z.string(), before: z.string(), after: z.string() })
  .strict();

export const RecordChangeViewSchema = z
  .object({
    recordId: z.string().min(1),
    kind: z.enum(['added', 'removed', 'modified']),
    changedFields: z.array(FieldChangeSchema),
    cited: z.boolean(),
  })
  .strict();

export const CollectionDiffSchema = z
  .object({
    collection: z.string().min(1),
    changes: z.array(RecordChangeViewSchema),
    cited: z.boolean(),
  })
  .strict();

export const ContractViewSchema = z
  .object({
    taskSummary: z.string(),
    contractHash: z.string().min(1),
    taskFingerprint: z.string().min(1),
    promptPath: z.string(),
    promptHash: z.string(),
    assertionSchemaVersion: z.string(),
    contractVersion: z.string(),
    /** Where this contract came from, in words a judge can check. */
    source: z.enum(['frozen-bundle', 'uploaded', 'compiled-this-session']),
    requirementCount: z.number().int().nonnegative(),
    ambiguities: z.array(z.string()),
  })
  .strict();

export const RunViewSchema = z
  .object({
    runId: z.string().min(1),
    label: z.string().min(1),
    caseId: z.string().nullable(),
    verifiedAt: z.string().min(1),
    mode: z.enum(['deterministic', 'model-assisted-compilation']),
    verificationDurationMs: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    modelTokens: z.number().int().nonnegative(),
    verdict: VerdictSchema,
    task: z.string(),
    agentClaim: z.string(),
    requirements: z.array(RequirementViewSchema),
    timeline: z.array(TimelineEventSchema),
    diff: z.array(CollectionDiffSchema),
    contract: ContractViewSchema,
    /** Present only for imported runs, so the UI can warn appropriately. */
    imported: z.boolean(),
  })
  .strict();

export type RunView = z.infer<typeof RunViewSchema>;

export const DemoSummarySchema = z
  .object({
    caseId: z.string().min(1),
    label: z.string().min(1),
    task: z.string(),
    agentClaim: z.string(),
    toolCallCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    collectionCount: z.number().int().nonnegative(),
    changedRecordCount: z.number().int().nonnegative(),
    contractHash: z.string().min(1),
    requirementCount: z.number().int().nonnegative(),
    whyThisCase: z.string(),
  })
  .strict();

export type DemoSummary = z.infer<typeof DemoSummarySchema>;

/** A validated but not-yet-verified import. */
export const ImportResultSchema = z
  .object({
    importId: z.string().min(1),
    caseLabel: z.string().min(1),
    task: z.string(),
    agentClaim: z.string(),
    eventCount: z.number().int().nonnegative(),
    collections: z.array(z.string()),
    contractStatus: z.enum([
      'uploaded-contract',
      'matched-frozen-contract',
      'compile-available',
      'no-contract',
    ]),
    contractHash: z.string().nullable(),
    matchedFingerprint: z.string().nullable(),
    nextAction: z.string().min(1),
    warnings: z.array(z.string()),
  })
  .strict();

export type ImportResult = z.infer<typeof ImportResultSchema>;

export const ImportRequestSchema = z
  .object({
    /** base64 of a run-package zip, or the individual files below. */
    zipBase64: z.string().optional(),
    files: z
      .object({
        'task.json': z.string().optional(),
        'tool-registry.json': z.string().optional(),
        'initial-state.json': z.string().optional(),
        'final-state.json': z.string().optional(),
        'trajectory.jsonl': z.string().optional(),
        'final-response.txt': z.string().optional(),
        'compiled-contract.json': z.string().optional(),
      })
      .optional(),
  })
  .strict()
  .refine((value) => value.zipBase64 !== undefined || value.files !== undefined, {
    message: 'provide either a run-package zip or the individual files',
  });

export const VerifyRequestSchema = z
  .object({ importId: z.string().min(1), contractSource: z.enum(['uploaded', 'frozen']) })
  .strict();

export const CompileRequestSchema = z.object({ importId: z.string().min(1) }).strict();

export const ApiErrorSchema = z
  .object({
    error: z.string().min(1),
    /** Field-specific problems, so the UI can point at the offending file. */
    details: z.array(z.object({ field: z.string(), message: z.string() }).strict()),
  })
  .strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const BenchmarkViewSchema = z
  .object({
    generatedFrom: z.string(),
    lockedEvaluationComplete: z.boolean(),
    qualityGuardrailsMet: z.boolean(),
    scopeNote: z.string(),
    splits: z.array(
      z
        .object({
          label: z.string(),
          caseCount: z.number().int().nonnegative(),
          baseline: z.record(z.string()),
          stateproof: z.record(z.string()),
        })
        .strict(),
    ),
    usage: z.array(
      z
        .object({
          label: z.string(),
          modelCalls: z.string(),
          totalTokens: z.string(),
          modelCallWall: z.string(),
          deterministicVerification: z.string(),
          endToEndElapsed: z.string(),
          apiCost: z.string(),
        })
        .strict(),
    ),
    changelog: z.array(
      z.object({ stage: z.string(), title: z.string(), outcome: z.string() }).strict(),
    ),
    reductions: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
  })
  .strict();

export type BenchmarkView = z.infer<typeof BenchmarkViewSchema>;
