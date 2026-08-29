import { z } from 'zod';

/**
 * The pinned set of artifacts the submission is allowed to talk about.
 *
 * Everything a judge sees — the dashboard, the summary, the replay — is built
 * from this registry, and the registry holds *references and integrity pins*,
 * never metrics. A number in the UI is therefore always a number some run
 * actually produced; there is nowhere to type one in.
 *
 * The hashes exist so that "this is the run we claim" is checkable rather than
 * asserted. If an artifact is edited after the fact, loading fails loudly
 * instead of rendering a plausible page.
 */

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex digest');
const CommitSha = z.string().regex(/^[0-9a-f]{7,40}$/);
const NonEmpty = z.string().min(1);

/**
 * Whether a run's manifest can be re-derived from the commit it names.
 *
 * Gate 3A's run predates its own commit, so its provenance genuinely does not
 * check out. That is pinned as a known defect rather than hidden: an unexpected
 * change in either direction is an error.
 */
export const ProvenanceExpectationSchema = z.enum(['verified', 'known-defect']);
export type ProvenanceExpectation = z.infer<typeof ProvenanceExpectationSchema>;

export const RegisteredPromptSchema = z
  .object({
    id: NonEmpty,
    label: NonEmpty,
    path: NonEmpty,
    sha256: Sha256,
  })
  .strict();

export type RegisteredPrompt = z.infer<typeof RegisteredPromptSchema>;

export const RegisteredRunSchema = z
  .object({
    id: NonEmpty,
    label: NonEmpty,
    /** Where this run sits in the story, used for ordering and grouping. */
    role: z.enum([
      'baseline-core',
      'baseline-hard',
      'baseline-hard-locked',
      'stateproof-v1-cold',
      'stateproof-v2-cold',
      'stateproof-v3-cold',
      'stateproof-v3-warm',
      'stateproof-v3-warm-repeat',
      'stateproof-v3-locked',
    ]),
    system: z.enum(['baseline', 'stateproof']),
    dataset: NonEmpty,
    split: z.enum(['development', 'locked']),
    manifestPath: NonEmpty,
    predictionPath: NonEmpty,
    reportJsonPath: NonEmpty,
    reportMarkdownPath: NonEmpty,
    /** sha256 over the canonical, runtime-independent prediction content. */
    canonicalPredictionSha256: Sha256,
    contractRunId: NonEmpty.nullable(),
    promptId: NonEmpty.nullable(),
    provenance: ProvenanceExpectationSchema,
  })
  .strict();

export type RegisteredRun = z.infer<typeof RegisteredRunSchema>;

export const RegisteredContractBundleSchema = z
  .object({
    contractRunId: NonEmpty,
    manifestPath: NonEmpty,
    promptId: NonEmpty,
    assertionSchemaVersion: NonEmpty,
    contracts: z
      .array(
        z
          .object({
            taskFingerprint: Sha256,
            contractHash: Sha256,
            path: NonEmpty,
            rawResponsePaths: z.array(NonEmpty).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type RegisteredContractBundle = z.infer<typeof RegisteredContractBundleSchema>;

export const ReproductionManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    generatedFor: NonEmpty,
    generatedAt: NonEmpty,
    /** Commits that contain the code and prompts behind the pinned runs. */
    sourceCommits: z.record(CommitSha),
    datasets: z
      .array(
        z
          .object({ name: NonEmpty, casesDir: NonEmpty, splitsDir: NonEmpty, caseCount: z.number().int().positive() })
          .strict(),
      )
      .min(1),
    prompts: z.array(RegisteredPromptSchema).min(1),
    runs: z.array(RegisteredRunSchema).min(1),
    contractBundles: z.array(RegisteredContractBundleSchema).min(1),
    /** The run whose development predictions a replay must reproduce exactly. */
    replayTargetRunId: NonEmpty,
    /** Development cases the replay covers. Locked ids must never appear here. */
    replayCaseIds: z.array(NonEmpty).min(1),
    lockedCaseIds: z.array(NonEmpty).min(1),
    /**
     * Locked cases the replay may re-verify, and the run it must reproduce.
     *
     * Absent until the one-time locked evaluation has happened. Re-verifying a
     * locked case deterministically from committed artifacts is reproduction,
     * not a second evaluation — but it is only legitimate once the evaluation
     * itself is on the record, which is why this field is driven by artifact
     * presence rather than being always-on.
     */
    lockedReplayCaseIds: z.array(NonEmpty).optional(),
    lockedReplayTargetRunId: NonEmpty.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const locked = new Set(manifest.lockedCaseIds);
    for (const caseId of manifest.replayCaseIds) {
      if (locked.has(caseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replayCaseIds'],
          message: `${caseId} belongs to the locked split and must never be replayed`,
        });
      }
    }
    const runIds = new Set(manifest.runs.map((run) => run.id));
    if (!runIds.has(manifest.replayTargetRunId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replayTargetRunId'],
        message: 'the replay target must be one of the registered runs',
      });
    }

    for (const caseId of manifest.lockedReplayCaseIds ?? []) {
      if (!locked.has(caseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lockedReplayCaseIds'],
          message: `${caseId} is not a locked case`,
        });
      }
    }
    if ((manifest.lockedReplayCaseIds ?? []).length > 0) {
      if (manifest.lockedReplayTargetRunId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lockedReplayTargetRunId'],
          message: 'a locked replay set needs the locked run it must reproduce',
        });
      } else if (!runIds.has(manifest.lockedReplayTargetRunId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lockedReplayTargetRunId'],
          message: 'the locked replay target must be one of the registered runs',
        });
      }
    }
  });

export type ReproductionManifest = z.infer<typeof ReproductionManifestSchema>;
