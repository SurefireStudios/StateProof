import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSERTION_SCHEMA_VERSION,
  type EvaluationRunManifest,
  EvaluationRunManifestSchema,
  type Split,
  sha256Hex,
  toJsonValue,
} from '@stateproof/core';
import {
  HARD_BENCHMARK_NAME,
  HARD_CASES_DIR,
  HARD_SPLITS_DIR,
  REPO_ROOT,
  caseIdsForSplit,
  hashAgentVisibleCase,
  loadAgentVisibleCase,
} from '@stateproof/benchmark';
import type { ModelClient } from '@stateproof/model-provider';
import { z } from 'zod';
import {
  type CompiledContractArtifactV2,
  ContractBundleError,
  type SourceContractReference,
  SourceContractReferenceSchema,
  loadContractBundle,
  verifyContractProvenance,
} from '../contract/bundle';
import {
  CONTRACT_PROMPT_PATH,
  assertContractRunIsNew,
  compileContractForCase,
  computeTaskFingerprint,
  contractPromptRepoPath,
  loadContractPrompt,
} from '../contract/compiler';
import { type SourceTreeStatus, assertCleanSourceTree, inspectSourceTree } from '../run/source-guard';
import { StateProofPredictionSchema, executeContract } from '../verify/executor';

/**
 * The StateProof workflow: compile once per unique task, then verify every run
 * with deterministic code.
 *
 * Two modes, and the difference between them is the whole point. A **cold** run
 * compiles the contracts it needs and costs model tokens once. A **warm** run
 * loads those same contracts from disk, verifies their integrity, and makes no
 * model call at all — no client, no credential. Gate 3A could only demonstrate
 * reuse inside a single process, which is a weaker claim than the one being
 * made, so warm mode exists to measure it rather than assume it.
 *
 * Phase order is the same rule the baseline follows, for the same reason: this
 * module imports only the agent-facing benchmark surface, so gold data is
 * unreachable, and predictions are on disk before the scorer opens a gold file.
 */

export const StateProofCaseEntrySchema = z
  .object({
    caseId: z.string().min(1),
    taskFingerprint: z.string().min(1),
    contractHash: z.string().min(1),
    cacheHit: z.boolean(),
    prediction: StateProofPredictionSchema,
  })
  .strict();

export const StateProofPredictionFileSchema = z
  .object({
    // 1.0.0 is Gate 3A's shape and still parses; 2.0.0 adds mode and the
    // source-bundle reference a warm run needs to be traceable.
    schemaVersion: z.union([z.literal('1.0.0'), z.literal('2.0.0')]),
    runId: z.string().min(1),
    system: z.literal('stateproof'),
    dataset: z.literal('phantombench-hard-12'),
    split: z.enum(['development', 'locked']),
    contractRunId: z.string().min(1),
    mode: z.enum(['cold', 'warm']).optional(),
    sourceContracts: SourceContractReferenceSchema.nullable().optional(),
    predictions: z.array(StateProofCaseEntrySchema).min(1),
  })
  .strict();

export type StateProofPredictionFile = z.infer<typeof StateProofPredictionFileSchema>;

export interface StateProofRunPaths {
  readonly artifactsDir: string;
  readonly predictionPath: string;
  readonly manifestPath: string;
  readonly contractManifestPath: string;
  readonly contractsDir: string;
}

interface CommonRunOptions {
  readonly split: Split;
  readonly artifactsDir: string;
  readonly casesDir?: string;
  readonly splitsDir?: string;
  readonly runId?: string;
  readonly onProgress?: (message: string) => void;
}

export interface ColdRunOptions extends CommonRunOptions {
  readonly mode?: 'cold';
  readonly client: ModelClient;
  readonly promptPath?: string;
  readonly contractRunId?: string;
  /** Live runs set this; tests and replays do not need a committed tree. */
  readonly requireCleanSource?: boolean;
  /** Which repository the clean-source rule applies to. Defaults to this one. */
  readonly sourceRepoRoot?: string;
}

export interface WarmRunOptions extends CommonRunOptions {
  readonly mode: 'warm';
  /** The contract run id whose persisted bundle this run verifies from. */
  readonly contractsFrom: string;
}

export type StateProofRunOptions = ColdRunOptions | WarmRunOptions;

export interface ContractCompilationSummary {
  readonly contractRunId: string;
  readonly uniqueTaskFingerprints: string[];
  readonly compilationCalls: number;
  readonly repairCalls: number;
  readonly cacheHits: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly wallClockMs: number;
  readonly artifacts: CompiledContractArtifactV2[];
}

export interface StateProofRunResult {
  readonly runId: string;
  readonly mode: 'cold' | 'warm';
  readonly paths: StateProofRunPaths;
  readonly predictionFile: StateProofPredictionFile;
  readonly manifest: EvaluationRunManifest;
  readonly compilation: ContractCompilationSummary;
  readonly verificationMs: number;
  readonly wallClockMs: number;
  readonly perCaseVerificationMs: Array<{ caseId: string; ms: number }>;
  readonly sourceContracts: SourceContractReference | null;
  readonly source: SourceTreeStatus;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
}

function packageLockHash(): string | null {
  const lockPath = path.join(REPO_ROOT, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) return null;
  return sha256Hex(readFileSync(lockPath, 'utf8'));
}

function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

export function makeStateProofRunId(split: Split, mode: 'cold' | 'warm' = 'cold'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `RUN-stateproof-hard-${split}-${mode}-${stamp}`;
}

export class WarmContractMissError extends Error {
  public readonly problems: string[];

  public constructor(problems: string[]) {
    super(
      [
        'Refusing to verify: the persisted contract bundle does not cover this run.',
        '',
        'Warm mode never compiles a miss — that would quietly turn a measured warm',
        'run into a partly cold one. Problems:',
        ...problems.map((problem) => `  - ${problem}`),
        '',
      ].join('\n'),
    );
    this.name = 'WarmContractMissError';
    this.problems = problems;
  }
}

/** Which contract each case verifies against, and whether it was already available. */
interface CasePlan {
  readonly caseId: string;
  readonly artifact: CompiledContractArtifactV2;
  readonly cacheHit: boolean;
}

export async function runStateProof(options: StateProofRunOptions): Promise<StateProofRunResult> {
  const warm = options.mode === 'warm';
  const casesDir = options.casesDir ?? HARD_CASES_DIR;
  const splitsDir = options.splitsDir ?? HARD_SPLITS_DIR;
  const runId = options.runId ?? makeStateProofRunId(options.split, warm ? 'warm' : 'cold');

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const caseIds = caseIdsForSplit(options.split, splitsDir);

  // A live cold run must be re-derivable from a commit; a warm run reads only
  // artifacts, so it is checked but never blocked on the tree being clean.
  const repoRoot = !warm ? options.sourceRepoRoot : undefined;
  const source =
    !warm && options.requireCleanSource === true
      ? assertCleanSourceTree(repoRoot)
      : inspectSourceTree(repoRoot);

  const agentVisibleHashes: string[] = [];
  for (const caseId of caseIds) {
    agentVisibleHashes.push(hashAgentVisibleCase(loadAgentVisibleCase(caseId, { casesDir })));
  }

  // The run id exists before anything is compiled, so the contract run id it
  // derives is unique per run rather than a constant.
  const phase = warm
    ? planWarm(options, caseIds, casesDir)
    : await planCold(options, caseIds, casesDir, source, runId);

  // --- phase 2: verify every run deterministically -------------------------
  const predictions: StateProofPredictionFile['predictions'] = [];
  const perCaseVerificationMs: Array<{ caseId: string; ms: number }> = [];
  const verificationStartedMs = Date.now();

  for (const plan of phase.plans) {
    const agentVisible = loadAgentVisibleCase(plan.caseId, { casesDir });
    const prediction = executeContract({
      contract: plan.artifact.contract,
      contractHash: plan.artifact.contractHash,
      agentVisible,
    });

    predictions.push({
      caseId: plan.caseId,
      taskFingerprint: plan.artifact.taskFingerprint,
      contractHash: plan.artifact.contractHash,
      cacheHit: plan.cacheHit,
      prediction,
    });
    perCaseVerificationMs.push({ caseId: plan.caseId, ms: prediction.verificationDurationMs });
    options.onProgress?.(
      `${plan.caseId}: ${prediction.verdict} (${prediction.requirementAssessments.length} assessed, ` +
        `${prediction.requirementAssessments.filter((a) => a.status === 'FAIL').length} failed, ` +
        `${prediction.verificationDurationMs} ms, 0 model calls)`,
    );
  }
  const verificationMs = Date.now() - verificationStartedMs;

  const paths: StateProofRunPaths = {
    artifactsDir: options.artifactsDir,
    predictionPath: path.join(options.artifactsDir, 'predictions', `${runId}.json`),
    manifestPath: path.join(options.artifactsDir, 'run-manifests', `${runId}.json`),
    contractManifestPath: path.join(
      options.artifactsDir,
      'run-manifests',
      `${phase.contractRunId}.json`,
    ),
    contractsDir: path.join(options.artifactsDir, 'contracts', phase.contractRunId),
  };

  const predictionFile: StateProofPredictionFile = {
    schemaVersion: '2.0.0',
    runId,
    system: 'stateproof',
    dataset: 'phantombench-hard-12',
    split: options.split,
    contractRunId: phase.contractRunId,
    mode: warm ? 'warm' : 'cold',
    sourceContracts: phase.sourceContracts,
    predictions,
  };
  // Phase boundary: predictions exist before any gold file is opened.
  writeJson(paths.predictionPath, predictionFile);

  const uniqueTaskFingerprints = phase.artifacts.map((artifact) => artifact.taskFingerprint).sort();
  const compilation: ContractCompilationSummary = {
    contractRunId: phase.contractRunId,
    uniqueTaskFingerprints,
    compilationCalls: phase.compilationCalls,
    repairCalls: phase.repairCalls,
    cacheHits: phase.cacheHits,
    inputTokens: phase.inputTokens,
    outputTokens: phase.outputTokens,
    wallClockMs: phase.wallClockMs,
    artifacts: phase.artifacts,
  };

  if (!warm) {
    // A bundle manifest, not just a log: it binds every contract hash so a
    // later warm run can tell a genuine artifact from an edited one.
    writeJson(paths.contractManifestPath, {
      schemaVersion: '2.0.0',
      contractRunId: phase.contractRunId,
      createdAt: startedAt,
      stage: 'gate-3b-contract-compilation',
      promptPath: phase.promptRepoPath,
      promptHash: phase.promptHash,
      assertionSchemaVersion: ASSERTION_SCHEMA_VERSION,
      contractVersion: '2',
      modelProvider: phase.modelProvider,
      modelId: phase.modelId,
      modelConfiguration: phase.modelConfiguration,
      gitCommitSha: source.commitSha,
      sourceTreeClean: source.clean,
      uniqueTaskFingerprints,
      contractHashes: Object.fromEntries(
        phase.artifacts.map((artifact) => [artifact.taskFingerprint, artifact.contractHash]),
      ),
      compilationCalls: phase.compilationCalls,
      repairCalls: phase.repairCalls,
      cacheHits: phase.cacheHits,
      tokenUsage: { inputTokens: phase.inputTokens, outputTokens: phase.outputTokens },
      wallClockMs: phase.wallClockMs,
      contractPaths: uniqueTaskFingerprints.map(
        (fingerprint) => `contracts/${phase.contractRunId}/${fingerprint}.json`,
      ),
      rawResponsePaths: phase.rawResponsePaths,
    });
  }

  const wallClockMs = Date.now() - startedMs;
  const manifest = EvaluationRunManifestSchema.parse({
    schemaVersion: '1.0.0',
    runId,
    createdAt: startedAt,
    system: 'stateproof',
    stage: `gate-3b-stateproof-${options.split}-${warm ? 'warm' : 'cold'}`,
    mode: 'live',
    gitCommitSha: source.commitSha,
    sourceTreeClean: source.clean,
    assertionSchemaVersion: ASSERTION_SCHEMA_VERSION,
    contractRunId: phase.contractRunId,
    sourceContractRunId: warm ? phase.contractRunId : null,
    runtimeVersion: `node-${process.versions.node}`,
    packageLockHash: packageLockHash(),
    datasetName: HARD_BENCHMARK_NAME,
    agentVisibleDatasetHash: sha256Hex(agentVisibleHashes.join('|')),
    datasetHash: null,
    splits: [options.split],
    caseIds,
    modelProvider: warm ? null : phase.modelProvider,
    modelId: warm ? null : phase.modelId,
    modelConfiguration: warm ? {} : phase.modelConfiguration,
    maxRetries: 1,
    timeoutPolicy: warm
      ? 'no model call is made in warm mode'
      : String(phase.modelConfiguration['timeoutMs'] ?? 'provider default'),
    promptFilePaths: [phase.promptRepoPath],
    promptHashes: { [phase.promptRepoPath]: phase.promptHash },
    startedAt,
    finishedAt: new Date().toISOString(),
    wallClockMs,
    modelUsage:
      phase.compilationCalls === 0
        ? null
        : {
            inputTokens: phase.inputTokens,
            outputTokens: phase.outputTokens,
            calls: phase.compilationCalls,
            retries: phase.repairCalls,
            estimatedCostUsd: null,
          },
    rawResponsePaths: phase.rawResponsePaths,
    trajectoryPaths: caseIds.map(
      (caseId) => `benchmarks/${HARD_BENCHMARK_NAME}/cases/${caseId}/trajectory.jsonl`,
    ),
    predictionPath: relative(options.artifactsDir, paths.predictionPath),
    reportPath: null,
    notes: [
      'Predictions were written before any gold file was read.',
      'Verification is deterministic: zero model calls during the run phase.',
      warm
        ? `Warm run: every contract was loaded and integrity-checked from ${phase.contractRunId}; no model call and no credential were used.`
        : `Contract compilation artifacts: run-manifests/${phase.contractRunId}.json and contracts/${phase.contractRunId}/.`,
      `Deterministic verification time: ${verificationMs} ms across ${caseIds.length} case(s).`,
    ],
  });
  writeJson(paths.manifestPath, manifest);

  return {
    runId,
    mode: warm ? 'warm' : 'cold',
    paths,
    predictionFile,
    manifest,
    compilation,
    verificationMs,
    wallClockMs,
    perCaseVerificationMs,
    sourceContracts: phase.sourceContracts,
    source,
  };
}

interface PhaseOneResult {
  readonly contractRunId: string;
  readonly plans: CasePlan[];
  readonly artifacts: CompiledContractArtifactV2[];
  readonly compilationCalls: number;
  readonly repairCalls: number;
  readonly cacheHits: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly wallClockMs: number;
  readonly rawResponsePaths: string[];
  readonly promptRepoPath: string;
  readonly promptHash: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelConfiguration: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceContracts: SourceContractReference | null;
}

/** Compile the unique task contracts, paying for each exactly once. */
async function planCold(
  options: ColdRunOptions,
  caseIds: readonly string[],
  casesDir: string,
  source: SourceTreeStatus,
  runId: string,
): Promise<PhaseOneResult> {
  const promptPath = options.promptPath ?? CONTRACT_PROMPT_PATH;
  const prompt = loadContractPrompt(promptPath);
  const contractRunId = options.contractRunId ?? `${runId}-contracts`;
  assertContractRunIsNew(options.artifactsDir, contractRunId);

  const cache = new Map<string, CompiledContractArtifactV2>();
  const startedMs = Date.now();
  let compilationCalls = 0;
  let repairCalls = 0;
  let cacheHits = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const rawResponsePaths: string[] = [];
  const plans: CasePlan[] = [];

  for (const caseId of caseIds) {
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir });
    const result = await compileContractForCase({
      client: options.client,
      agentVisible,
      artifactsDir: options.artifactsDir,
      contractRunId,
      promptPath,
      cache,
      source,
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: (message: string) => options.onProgress?.(`${caseId}: ${message}`) }),
    });

    if (result.cacheHit) {
      cacheHits += 1;
    } else {
      compilationCalls += result.attempts.length;
      repairCalls += Math.max(0, result.attempts.length - 1);
      inputTokens += result.artifact.tokenUsage?.inputTokens ?? 0;
      outputTokens += result.artifact.tokenUsage?.outputTokens ?? 0;
      rawResponsePaths.push(...result.artifact.rawResponsePaths);
    }
    // Honest per-case metadata: the first case that needed a contract paid for
    // it, and every later case with the same fingerprint did not.
    plans.push({ caseId, artifact: result.artifact, cacheHit: result.cacheHit });
  }

  return {
    contractRunId,
    plans,
    artifacts: [...cache.values()],
    compilationCalls,
    repairCalls,
    cacheHits,
    inputTokens,
    outputTokens,
    wallClockMs: Date.now() - startedMs,
    rawResponsePaths,
    promptRepoPath: contractPromptRepoPath(promptPath),
    promptHash: prompt.hash,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
    sourceContracts: null,
  };
}

/**
 * Load the persisted bundle and match every case to it. No model client exists
 * in this path, so a miss cannot be repaired by compiling: it fails closed.
 */
function planWarm(
  options: WarmRunOptions,
  caseIds: readonly string[],
  casesDir: string,
): PhaseOneResult {
  const startedMs = Date.now();
  let bundle;
  try {
    bundle = loadContractBundle(options.artifactsDir, options.contractsFrom);
  } catch (error) {
    if (error instanceof ContractBundleError) throw error;
    throw error;
  }

  const plans: CasePlan[] = [];
  const problems: string[] = [];

  for (const caseId of caseIds) {
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir });
    // Recomputed from the task in front of us, never read from the artifact.
    const fingerprint = computeTaskFingerprint({
      taskText: agentVisible.task.instruction,
      toolRegistry: agentVisible.toolRegistry,
      promptHash: bundle.manifest.promptHash,
      modelProvider: bundle.manifest.modelProvider,
      modelId: bundle.manifest.modelId,
      modelConfiguration: bundle.manifest.modelConfiguration,
    });

    const artifact = bundle.artifacts.get(fingerprint.fingerprint);
    if (artifact === undefined) {
      problems.push(
        `${caseId}: no persisted contract for task fingerprint ${fingerprint.fingerprint.slice(0, 12)}`,
      );
      continue;
    }

    const provenance = verifyContractProvenance(artifact, {
      taskFingerprint: fingerprint.fingerprint,
      toolRegistryHash: fingerprint.toolRegistryHash,
      domainSchemaHash: fingerprint.domainSchemaHash,
      promptHash: bundle.manifest.promptHash,
      modelProvider: bundle.manifest.modelProvider,
      modelId: bundle.manifest.modelId,
      modelConfiguration: bundle.manifest.modelConfiguration,
    });
    if (provenance.length > 0) {
      problems.push(`${caseId}: ${provenance.join('; ')}`);
      continue;
    }

    options.onProgress?.(
      `${caseId}: persisted contract ${fingerprint.fingerprint.slice(0, 12)} (0 model calls)`,
    );
    plans.push({ caseId, artifact, cacheHit: true });
  }

  if (problems.length > 0) throw new WarmContractMissError(problems);

  const used = new Map<string, CompiledContractArtifactV2>();
  for (const plan of plans) used.set(plan.artifact.taskFingerprint, plan.artifact);

  return {
    contractRunId: options.contractsFrom,
    plans,
    artifacts: [...used.values()],
    compilationCalls: 0,
    repairCalls: 0,
    cacheHits: plans.length,
    inputTokens: 0,
    outputTokens: 0,
    wallClockMs: Date.now() - startedMs,
    rawResponsePaths: [],
    promptRepoPath: bundle.manifest.promptPath,
    promptHash: bundle.manifest.promptHash,
    modelProvider: bundle.manifest.modelProvider,
    modelId: bundle.manifest.modelId,
    modelConfiguration: bundle.manifest.modelConfiguration,
    sourceContracts: bundle.reference,
  };
}
