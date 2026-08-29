import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
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
  CONTRACT_PROMPT_REPO_PATH,
  type CompiledContractArtifact,
  compileContractForCase,
  loadContractPrompt,
} from '../contract/compiler';
import { StateProofPredictionSchema, executeContract } from '../verify/executor';

/**
 * The StateProof workflow: compile once per unique task, then verify every run
 * with deterministic code.
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
    schemaVersion: z.literal('1.0.0'),
    runId: z.string().min(1),
    system: z.literal('stateproof'),
    dataset: z.literal('phantombench-hard-12'),
    split: z.enum(['development', 'locked']),
    contractRunId: z.string().min(1),
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

export interface StateProofRunOptions {
  readonly client: ModelClient;
  readonly split: Split;
  readonly artifactsDir: string;
  readonly casesDir?: string;
  readonly splitsDir?: string;
  readonly promptPath?: string;
  readonly runId?: string;
  readonly contractRunId?: string;
  readonly onProgress?: (message: string) => void;
}

export interface ContractCompilationSummary {
  readonly contractRunId: string;
  readonly uniqueTaskFingerprints: string[];
  readonly compilationCalls: number;
  readonly repairCalls: number;
  readonly cacheHits: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly wallClockMs: number;
  readonly artifacts: CompiledContractArtifact[];
}

export interface StateProofRunResult {
  readonly runId: string;
  readonly paths: StateProofRunPaths;
  readonly predictionFile: StateProofPredictionFile;
  readonly manifest: EvaluationRunManifest;
  readonly compilation: ContractCompilationSummary;
  readonly verificationMs: number;
  readonly perCaseVerificationMs: Array<{ caseId: string; ms: number }>;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
}

function gitCommitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function packageLockHash(): string | null {
  const lockPath = path.join(REPO_ROOT, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) return null;
  return sha256Hex(readFileSync(lockPath, 'utf8'));
}

function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

export function makeStateProofRunId(split: Split): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `RUN-stateproof-hard-${split}-live-${stamp}`;
}

export async function runStateProof(options: StateProofRunOptions): Promise<StateProofRunResult> {
  const casesDir = options.casesDir ?? HARD_CASES_DIR;
  const splitsDir = options.splitsDir ?? HARD_SPLITS_DIR;
  const runId = options.runId ?? makeStateProofRunId(options.split);
  const contractRunId = options.contractRunId ?? `${runId}-contracts`;
  const prompt = loadContractPrompt(options.promptPath);

  const paths: StateProofRunPaths = {
    artifactsDir: options.artifactsDir,
    predictionPath: path.join(options.artifactsDir, 'predictions', `${runId}.json`),
    manifestPath: path.join(options.artifactsDir, 'run-manifests', `${runId}.json`),
    contractManifestPath: path.join(options.artifactsDir, 'run-manifests', `${contractRunId}.json`),
    contractsDir: path.join(options.artifactsDir, 'contracts', contractRunId),
  };

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const caseIds = caseIdsForSplit(options.split, splitsDir);

  // --- phase 1: compile the unique task contracts --------------------------
  const cache = new Map<string, CompiledContractArtifact>();
  const compilationStartedMs = Date.now();
  let compilationCalls = 0;
  let repairCalls = 0;
  let cacheHits = 0;
  let contractInputTokens = 0;
  let contractOutputTokens = 0;
  const rawResponsePaths: string[] = [];

  const perCaseContract = new Map<string, CompiledContractArtifact>();
  const agentVisibleHashes: string[] = [];

  for (const caseId of caseIds) {
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir });
    agentVisibleHashes.push(hashAgentVisibleCase(agentVisible));

    const result = await compileContractForCase({
      client: options.client,
      agentVisible,
      artifactsDir: options.artifactsDir,
      contractRunId,
      ...(options.promptPath === undefined ? {} : { promptPath: options.promptPath }),
      cache,
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: (message) => options.onProgress?.(`${caseId}: ${message}`) }),
    });

    if (result.cacheHit) {
      cacheHits += 1;
    } else {
      compilationCalls += result.attempts.length;
      repairCalls += Math.max(0, result.attempts.length - 1);
      contractInputTokens += result.artifact.tokenUsage?.inputTokens ?? 0;
      contractOutputTokens += result.artifact.tokenUsage?.outputTokens ?? 0;
      rawResponsePaths.push(...result.artifact.rawResponsePaths);
    }
    perCaseContract.set(caseId, result.artifact);
  }
  const compilationWallMs = Date.now() - compilationStartedMs;

  // --- phase 2: verify every run deterministically -------------------------
  const predictions: StateProofPredictionFile['predictions'] = [];
  const perCaseVerificationMs: Array<{ caseId: string; ms: number }> = [];
  const verificationStartedMs = Date.now();

  for (const caseId of caseIds) {
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir });
    const artifact = perCaseContract.get(caseId);
    if (artifact === undefined) throw new Error(`no compiled contract for ${caseId}`);

    const prediction = executeContract({
      contract: artifact.contract,
      contractHash: artifact.contractHash,
      agentVisible,
    });

    predictions.push({
      caseId,
      taskFingerprint: artifact.taskFingerprint,
      contractHash: artifact.contractHash,
      cacheHit: false,
      prediction,
    });
    perCaseVerificationMs.push({ caseId, ms: prediction.verificationDurationMs });
    options.onProgress?.(
      `${caseId}: ${prediction.verdict} (${prediction.requirementAssessments.length} assessed, ` +
        `${prediction.requirementAssessments.filter((a) => a.status === 'FAIL').length} failed, ` +
        `${prediction.verificationDurationMs} ms, 0 model calls)`,
    );
  }
  const verificationMs = Date.now() - verificationStartedMs;

  const predictionFile: StateProofPredictionFile = {
    schemaVersion: '1.0.0',
    runId,
    system: 'stateproof',
    dataset: 'phantombench-hard-12',
    split: options.split,
    contractRunId,
    predictions,
  };
  // Phase boundary: predictions exist before any gold file is opened.
  writeJson(paths.predictionPath, predictionFile);

  const contractArtifacts = [...cache.values()];
  const uniqueTaskFingerprints = contractArtifacts.map((artifact) => artifact.taskFingerprint).sort();

  const compilation: ContractCompilationSummary = {
    contractRunId,
    uniqueTaskFingerprints,
    compilationCalls,
    repairCalls,
    cacheHits,
    inputTokens: contractInputTokens,
    outputTokens: contractOutputTokens,
    wallClockMs: compilationWallMs,
    artifacts: contractArtifacts,
  };

  // A separate manifest for the compilation phase, so a cached contract can be
  // traced to the exact prompt and model that produced it.
  writeJson(paths.contractManifestPath, {
    schemaVersion: '1.0.0',
    contractRunId,
    createdAt: startedAt,
    stage: 'gate-3a-contract-compilation',
    promptPath: CONTRACT_PROMPT_REPO_PATH,
    promptHash: prompt.hash,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
    gitCommitSha: gitCommitSha(),
    uniqueTaskFingerprints,
    compilationCalls,
    repairCalls,
    cacheHits,
    tokenUsage: { inputTokens: contractInputTokens, outputTokens: contractOutputTokens },
    wallClockMs: compilationWallMs,
    contractPaths: uniqueTaskFingerprints.map(
      (fingerprint) => `contracts/${contractRunId}/${fingerprint}.json`,
    ),
    rawResponsePaths,
  });

  const manifest = EvaluationRunManifestSchema.parse({
    schemaVersion: '1.0.0',
    runId,
    createdAt: startedAt,
    system: 'stateproof',
    stage: 'gate-3a-stateproof-development',
    mode: 'live',
    gitCommitSha: gitCommitSha(),
    runtimeVersion: `node-${process.versions.node}`,
    packageLockHash: packageLockHash(),
    datasetName: HARD_BENCHMARK_NAME,
    agentVisibleDatasetHash: sha256Hex(agentVisibleHashes.join('|')),
    datasetHash: null,
    splits: [options.split],
    caseIds,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
    maxRetries: 1,
    timeoutPolicy: String(options.client.configuration['timeoutMs'] ?? 'provider default'),
    promptFilePaths: [CONTRACT_PROMPT_REPO_PATH],
    promptHashes: { [CONTRACT_PROMPT_REPO_PATH]: prompt.hash },
    startedAt,
    finishedAt: new Date().toISOString(),
    wallClockMs: Date.now() - startedMs,
    modelUsage:
      compilationCalls === 0
        ? null
        : {
            inputTokens: contractInputTokens,
            outputTokens: contractOutputTokens,
            calls: compilationCalls,
            retries: repairCalls,
            estimatedCostUsd: null,
          },
    rawResponsePaths,
    trajectoryPaths: caseIds.map(
      (caseId) => `benchmarks/${HARD_BENCHMARK_NAME}/cases/${caseId}/trajectory.jsonl`,
    ),
    predictionPath: relative(options.artifactsDir, paths.predictionPath),
    reportPath: null,
    notes: [
      'Predictions were written before any gold file was read.',
      'Verification is deterministic: zero model calls during the run phase.',
      `Contract compilation artifacts: run-manifests/${contractRunId}.json and contracts/${contractRunId}/.`,
      `Deterministic verification time: ${verificationMs} ms across ${caseIds.length} case(s).`,
    ],
  });
  writeJson(paths.manifestPath, manifest);

  return {
    runId,
    paths,
    predictionFile,
    manifest,
    compilation,
    verificationMs,
    perCaseVerificationMs,
  };
}
