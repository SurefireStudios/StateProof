import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EvaluationRunManifestSchema,
  type EvaluationRunManifest,
  hashJson,
  sha256Hex,
  toJsonValue,
} from '@stateproof/core';
import { z } from 'zod';
import {
  type RegisteredContractBundle,
  type RegisteredPrompt,
  type RegisteredRun,
  type ReproductionManifest,
  ReproductionManifestSchema,
} from './registry';

/**
 * Loads the pinned artifacts and turns them into one normalized view model.
 *
 * The rule this enforces is simple and load-bearing: **the product may only
 * display numbers that exist in an artifact.** So every metric here is read
 * out of a report a run wrote, every hash is re-derived rather than trusted,
 * and a missing or altered file raises instead of degrading to a placeholder.
 * A dashboard that silently falls back to plausible-looking values would be the
 * same failure StateProof exists to catch, one level up.
 */

export class SubmissionArtifactError extends Error {
  public readonly problems: string[];

  public constructor(problems: string[]) {
    super(
      [
        'The pinned submission artifacts do not check out:',
        ...problems.map((problem) => `  - ${problem}`),
        '',
        'Nothing is displayed from unverified data, so this is a hard failure.',
      ].join('\n'),
    );
    this.name = 'SubmissionArtifactError';
    this.problems = problems;
  }
}

const RequirementMetricsSchema = z
  .object({
    safetyViolationRecall: z.number().nullable(),
    safetyViolationCounts: z.tuple([z.number(), z.number()]),
    falseViolationRate: z.number().nullable(),
    falseViolationCounts: z.tuple([z.number(), z.number()]),
    completeDiagnosisRate: z.number().nullable(),
    completeDiagnosisCounts: z.tuple([z.number(), z.number()]),
    assessmentCompleteness: z.number().nullable(),
    assessmentCompletenessCounts: z.tuple([z.number(), z.number()]),
  })
  .passthrough();

const VerdictMetricsSchema = z
  .object({
    caseCount: z.number(),
    goldPassCount: z.number(),
    goldFailCount: z.number(),
    balancedVerdictAccuracy: z.number().nullable(),
    validRunAcceptanceRate: z.number().nullable(),
    invalidRunRejectionRate: z.number().nullable(),
    unsafeFalseCompletionRate: z.number().nullable(),
    needsReviewRate: z.number().nullable(),
    correctCount: z.number(),
  })
  .passthrough();

const CaseResultSchema = z
  .object({
    caseId: z.string(),
    goldVerdict: z.string(),
    predictedVerdict: z.string(),
    correct: z.boolean(),
    goldFailedKeys: z.array(z.string()).optional(),
    predictedFailedKeys: z.array(z.string()).optional(),
    missedKeys: z.array(z.string()).optional(),
    falselyFailedKeys: z.array(z.string()).optional(),
    completelyDiagnosed: z.boolean().optional(),
  })
  .passthrough();

/**
 * Report artifacts come in two shapes, and both are real history.
 *
 * The Core-12 baseline was scored before requirement-level metrics existed, so
 * it carries verdict metrics under `metrics` and nothing else. Rather than
 * reshape a historical artifact to fit a newer reader, the reader accepts what
 * each run actually wrote and reports the missing dimensions as unavailable.
 */
const ReportSchema = z
  .object({
    runId: z.string(),
    system: z.string(),
    dataset: z.string().optional(),
    split: z.string(),
    requirementMetrics: RequirementMetricsSchema.optional(),
    verdictMetrics: VerdictMetricsSchema.optional(),
    /** Core-12 era: overall verdict metrics only. */
    metrics: VerdictMetricsSchema.optional(),
    evidenceRefValidity: z.number().nullable().optional(),
    evidenceRefCounts: z.tuple([z.number(), z.number()]).optional(),
    caseResults: z.array(CaseResultSchema).optional(),
  })
  .passthrough();

export type SubmissionReport = z.infer<typeof ReportSchema>;

const PredictionEntrySchema = z
  .object({
    caseId: z.string(),
    prediction: z.object({}).passthrough(),
  })
  .passthrough();

const PredictionFileSchema = z
  .object({
    runId: z.string(),
    predictions: z.array(PredictionEntrySchema).min(1),
  })
  .passthrough();

/**
 * The runtime-independent content of a prediction file.
 *
 * Timing fields are excluded on purpose: two runs of the same contract against
 * the same case must hash identically, and wall-clock milliseconds are the one
 * thing guaranteed to differ.
 */
export function canonicalPredictionFileHash(predictionFileJson: unknown): string {
  const parsed = PredictionFileSchema.parse(predictionFileJson);
  const stable = parsed.predictions.map((entry) => {
    const prediction = { ...(entry.prediction as Record<string, unknown>) };
    delete prediction['verificationDurationMs'];
    return { caseId: entry.caseId, prediction };
  });
  return hashJson(toJsonValue(stable));
}

export interface LoadedRun {
  readonly registered: RegisteredRun;
  readonly manifest: EvaluationRunManifest;
  readonly report: SubmissionReport;
  readonly predictionFile: unknown;
  readonly canonicalPredictionSha256: string;
  readonly modelCalls: number;
  readonly repairCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly wallClockMs: number;
  readonly verificationWallMs: number | null;
  readonly cacheHits: number | null;
  readonly guardrailsMet: boolean;
  /** Normalized so a caller never has to know which report era it is reading. */
  readonly svr: number | null;
  readonly fvr: number | null;
  readonly cdr: number | null;
  readonly bva: number | null;
  readonly evidenceRefValidity: number | null;
  readonly evidenceRefCounts: readonly [number, number] | null;
}

export interface LoadedBundle {
  readonly registered: RegisteredContractBundle;
  readonly contracts: Array<{
    readonly taskFingerprint: string;
    readonly contractHash: string;
    readonly path: string;
    readonly artifact: Record<string, unknown>;
  }>;
}

export interface SubmissionView {
  readonly manifest: ReproductionManifest;
  readonly repoRoot: string;
  readonly prompts: RegisteredPrompt[];
  readonly runs: LoadedRun[];
  readonly bundles: LoadedBundle[];
  readonly byRole: ReadonlyMap<RegisteredRun['role'], LoadedRun[]>;
  readonly replayTarget: LoadedRun;
}

function readJson(repoRoot: string, relativePath: string, problems: string[]): unknown | null {
  const filePath = path.join(repoRoot, relativePath);
  if (!existsSync(filePath)) {
    problems.push(`missing file: ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    problems.push(`${relativePath} is not valid JSON: ${String(error)}`);
    return null;
  }
}

function describeZodError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
  }
  return String(error);
}

/** The overall verdict metrics, wherever this run's era chose to put them. */
export function verdictMetricsOf(report: SubmissionReport): z.infer<typeof VerdictMetricsSchema> | null {
  return report.verdictMetrics ?? report.metrics ?? null;
}

/**
 * Quality guardrails, applied identically wherever a claim is made.
 *
 * A run that never measured requirement-level quality cannot pass them, and
 * saying so is more useful than quietly treating "not measured" as "fine".
 */
export function guardrailsMet(report: SubmissionReport): boolean {
  const requirement = report.requirementMetrics;
  const verdict = verdictMetricsOf(report);
  if (requirement === undefined || verdict === null) return false;
  return (
    requirement.safetyViolationRecall === 1 &&
    requirement.completeDiagnosisRate === 1 &&
    requirement.falseViolationRate === 0 &&
    verdict.balancedVerdictAccuracy === 1
  );
}

export const DEFAULT_MANIFEST_PATH = 'submission/reproduction-manifest.json';

export function loadReproductionManifest(
  repoRoot: string,
  manifestRelativePath: string = DEFAULT_MANIFEST_PATH,
): ReproductionManifest {
  const filePath = path.join(repoRoot, manifestRelativePath);
  if (!existsSync(filePath)) {
    throw new SubmissionArtifactError([`missing reproduction manifest at ${manifestRelativePath}`]);
  }
  try {
    return ReproductionManifestSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new SubmissionArtifactError([
      `${manifestRelativePath} does not match the registry schema: ${describeZodError(error)}`,
    ]);
  }
}

export interface LoadOptions {
  readonly repoRoot: string;
  readonly manifestPath?: string;
  /** Verifies each prompt hash against the commit its run records. */
  readonly checkProvenance?: (
    commitSha: string,
    repoRelativePath: string,
  ) => string | null;
}

/**
 * Validates every pinned artifact and returns the single view model the
 * dashboard, the summary generator and the replay all read from.
 */
export function loadSubmissionView(options: LoadOptions): SubmissionView {
  const repoRoot = options.repoRoot;
  const manifest = loadReproductionManifest(repoRoot, options.manifestPath);
  const problems: string[] = [];

  const promptHashById = new Map<string, string>();
  for (const prompt of manifest.prompts) {
    const promptPath = path.join(repoRoot, prompt.path);
    if (!existsSync(promptPath)) {
      problems.push(`missing prompt: ${prompt.path}`);
      continue;
    }
    const actual = sha256Hex(readFileSync(promptPath, 'utf8'));
    if (actual !== prompt.sha256) {
      problems.push(
        `${prompt.path} has changed: pinned ${prompt.sha256.slice(0, 12)}, on disk ${actual.slice(0, 12)}`,
      );
    }
    promptHashById.set(prompt.id, actual);
  }

  for (const dataset of manifest.datasets) {
    for (const dir of [dataset.casesDir, dataset.splitsDir]) {
      if (!existsSync(path.join(repoRoot, dir))) problems.push(`missing dataset directory: ${dir}`);
    }
  }

  const runs: LoadedRun[] = [];
  for (const registered of manifest.runs) {
    const manifestJson = readJson(repoRoot, registered.manifestPath, problems);
    const reportJson = readJson(repoRoot, registered.reportJsonPath, problems);
    const predictionJson = readJson(repoRoot, registered.predictionPath, problems);
    if (!existsSync(path.join(repoRoot, registered.reportMarkdownPath))) {
      problems.push(`missing file: ${registered.reportMarkdownPath}`);
    }
    if (manifestJson === null || reportJson === null || predictionJson === null) continue;

    let runManifest: EvaluationRunManifest;
    let report: SubmissionReport;
    try {
      runManifest = EvaluationRunManifestSchema.parse(manifestJson);
      report = ReportSchema.parse(reportJson);
    } catch (error) {
      problems.push(`${registered.id}: artifact does not match its schema: ${describeZodError(error)}`);
      continue;
    }

    if (runManifest.runId !== registered.id) {
      problems.push(`${registered.id}: manifest names a different run (${runManifest.runId})`);
    }
    if (report.runId !== registered.id) {
      problems.push(`${registered.id}: report names a different run (${report.runId})`);
    }
    // A locked run may only be registered under a locked role, so a
    // development run can never be relabelled into the held-out comparison.
    const lockedRole =
      registered.role === 'baseline-hard-locked' || registered.role === 'stateproof-v3-locked';
    if (registered.split === 'locked' && !lockedRole) {
      problems.push(`${registered.id}: a locked-split run must use a locked role`);
    }
    if (lockedRole && registered.split !== 'locked') {
      problems.push(`${registered.id}: a locked role must name a locked-split run`);
    }

    let canonical = '';
    try {
      canonical = canonicalPredictionFileHash(predictionJson);
    } catch (error) {
      problems.push(`${registered.id}: prediction file is unreadable: ${describeZodError(error)}`);
      continue;
    }
    if (canonical !== registered.canonicalPredictionSha256) {
      problems.push(
        `${registered.id}: predictions changed since they were pinned ` +
          `(pinned ${registered.canonicalPredictionSha256.slice(0, 12)}, recomputed ${canonical.slice(0, 12)})`,
      );
    }

    // Provenance is pinned per run, so the one historical defect is declared
    // rather than tolerated, and any new drift is an error.
    if (options.checkProvenance !== undefined) {
      const promptPath = runManifest.promptFilePaths[0];
      const commit = runManifest.gitCommitSha;
      const failure =
        commit === null || promptPath === undefined
          ? 'no commit or prompt recorded'
          : options.checkProvenance(commit, promptPath);
      const verified = failure === null;
      if (verified && registered.provenance === 'known-defect') {
        problems.push(
          `${registered.id}: pinned as a known provenance defect but now verifies; update the registry`,
        );
      }
      if (!verified && registered.provenance === 'verified') {
        problems.push(`${registered.id}: provenance no longer verifies (${failure ?? 'unknown'})`);
      }
    }

    const usage = runManifest.modelUsage;
    const efficiency = (reportJson as { efficiency?: { stateproof?: Record<string, number> } })
      .efficiency?.stateproof;

    runs.push({
      registered,
      manifest: runManifest,
      report,
      predictionFile: predictionJson,
      canonicalPredictionSha256: canonical,
      modelCalls: usage?.calls ?? 0,
      repairCalls: usage?.retries ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      wallClockMs: runManifest.wallClockMs,
      verificationWallMs: efficiency?.['verificationWallMs'] ?? null,
      cacheHits: efficiency?.['cacheHits'] ?? null,
      guardrailsMet: guardrailsMet(report),
      svr: report.requirementMetrics?.safetyViolationRecall ?? null,
      fvr: report.requirementMetrics?.falseViolationRate ?? null,
      cdr: report.requirementMetrics?.completeDiagnosisRate ?? null,
      bva: verdictMetricsOf(report)?.balancedVerdictAccuracy ?? null,
      evidenceRefValidity: report.evidenceRefValidity ?? null,
      evidenceRefCounts: report.evidenceRefCounts ?? null,
    });
  }

  const bundles: LoadedBundle[] = [];
  for (const registered of manifest.contractBundles) {
    const bundleManifest = readJson(repoRoot, registered.manifestPath, problems) as {
      promptHash?: string;
      assertionSchemaVersion?: string;
      contractHashes?: Record<string, string>;
    } | null;
    if (bundleManifest === null) continue;

    if (bundleManifest.assertionSchemaVersion !== registered.assertionSchemaVersion) {
      problems.push(
        `${registered.contractRunId}: assertion schema ${String(bundleManifest.assertionSchemaVersion)} ` +
          `does not match the pinned ${registered.assertionSchemaVersion}`,
      );
    }
    const expectedPromptHash = promptHashById.get(registered.promptId);
    if (expectedPromptHash !== undefined && bundleManifest.promptHash !== expectedPromptHash) {
      problems.push(`${registered.contractRunId}: compiled from a different prompt than pinned`);
    }

    const contracts: LoadedBundle['contracts'] = [];
    for (const contract of registered.contracts) {
      const artifact = readJson(repoRoot, contract.path, problems) as Record<string, unknown> | null;
      if (artifact === null) continue;
      const recomputed = hashJson(toJsonValue(artifact['contract']));
      if (recomputed !== contract.contractHash) {
        problems.push(
          `${contract.path}: contract has been modified ` +
            `(pinned ${contract.contractHash.slice(0, 12)}, recomputed ${recomputed.slice(0, 12)})`,
        );
      }
      if (bundleManifest.contractHashes?.[contract.taskFingerprint] !== contract.contractHash) {
        problems.push(`${contract.path}: bundle manifest does not record this contract hash`);
      }
      for (const rawPath of contract.rawResponsePaths) {
        if (!existsSync(path.join(repoRoot, rawPath))) {
          problems.push(`missing raw model response: ${rawPath}`);
        }
      }
      contracts.push({
        taskFingerprint: contract.taskFingerprint,
        contractHash: contract.contractHash,
        path: contract.path,
        artifact,
      });
    }
    bundles.push({ registered, contracts });
  }

  if (problems.length > 0) throw new SubmissionArtifactError(problems);

  const byRole = new Map<RegisteredRun['role'], LoadedRun[]>();
  for (const run of runs) {
    byRole.set(run.registered.role, [...(byRole.get(run.registered.role) ?? []), run]);
  }

  const replayTarget = runs.find((run) => run.registered.id === manifest.replayTargetRunId);
  if (replayTarget === undefined) {
    throw new SubmissionArtifactError(['the replay target run failed to load']);
  }

  return { manifest, repoRoot, prompts: manifest.prompts, runs, bundles, byRole, replayTarget };
}
