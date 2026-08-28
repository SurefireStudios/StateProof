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
import { type ModelClient, requestStructured } from '@stateproof/model-provider';
import {
  type HardCasePrediction,
  type HardPredictionFile,
  HardBaselinePredictionSchema,
} from './hard-schema';
import { hashRenderedPrompt, loadBaselinePrompt, renderBaselineUserMessage } from './prompt';

/**
 * Phase 1 of the hard baseline: predict.
 *
 * Structurally identical to the v1 runner, and subject to the same ordering
 * rule: this module imports only the agent-facing benchmark surface, so gold
 * data is unreachable from here. Scoring happens afterwards, in `hard-score`.
 */

export const HARD_PROMPT_REPO_PATH = 'prompts/baseline-evaluator/v2.md';
export const HARD_PROMPT_PATH = path.join(REPO_ROOT, 'prompts', 'baseline-evaluator', 'v2.md');
export const HARD_MAX_REPAIR_ATTEMPTS = 1;

export interface HardRunPaths {
  readonly artifactsDir: string;
  readonly rawResponsesDir: string;
  readonly predictionPath: string;
  readonly manifestPath: string;
}

export interface HardRunOptions {
  readonly client: ModelClient;
  readonly split: Split;
  readonly artifactsDir: string;
  readonly casesDir?: string;
  readonly splitsDir?: string;
  readonly promptPath?: string;
  readonly runId?: string;
  readonly onProgress?: (message: string) => void;
}

export interface HardRunResult {
  readonly runId: string;
  readonly paths: HardRunPaths;
  readonly predictionFile: HardPredictionFile;
  readonly manifest: EvaluationRunManifest;
}

function isoNow(): string {
  return new Date().toISOString();
}

export function makeHardRunId(split: Split): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `RUN-baseline-hard-${split}-live-${stamp}`;
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

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
}

function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

export async function runHardBaselinePredictions(
  options: HardRunOptions,
): Promise<HardRunResult> {
  const casesDir = options.casesDir ?? HARD_CASES_DIR;
  const splitsDir = options.splitsDir ?? HARD_SPLITS_DIR;
  const runId = options.runId ?? makeHardRunId(options.split);
  const prompt = loadBaselinePrompt(options.promptPath ?? HARD_PROMPT_PATH);

  const paths: HardRunPaths = {
    artifactsDir: options.artifactsDir,
    rawResponsesDir: path.join(options.artifactsDir, 'model-responses', runId),
    predictionPath: path.join(options.artifactsDir, 'predictions', `${runId}.json`),
    manifestPath: path.join(options.artifactsDir, 'run-manifests', `${runId}.json`),
  };

  const startedAt = isoNow();
  const startedMs = Date.now();
  const caseIds = caseIdsForSplit(options.split, splitsDir);

  const predictions: HardCasePrediction[] = [];
  const rawResponsePaths: string[] = [];
  const agentVisibleHashes: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let calls = 0;
  let retries = 0;

  for (const caseId of caseIds) {
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir });
    agentVisibleHashes.push(hashAgentVisibleCase(agentVisible));
    const userMessage = renderBaselineUserMessage(prompt, agentVisible);
    const caseStartedMs = Date.now();

    const result = await requestStructured({
      client: options.client,
      system: prompt.system,
      userMessage,
      schema: HardBaselinePredictionSchema,
      maxRepairAttempts: HARD_MAX_REPAIR_ATTEMPTS,
    });

    const casePaths: string[] = [];
    for (const attempt of result.attempts) {
      const attemptPath = path.join(paths.rawResponsesDir, `${caseId}-attempt-${attempt.attempt}.json`);
      writeJson(attemptPath, attempt);
      const rel = relative(options.artifactsDir, attemptPath);
      casePaths.push(rel);
      rawResponsePaths.push(rel);

      calls += 1;
      if (attempt.kind === 'repair') retries += 1;
      totalInputTokens += attempt.usage?.inputTokens ?? 0;
      totalOutputTokens += attempt.usage?.outputTokens ?? 0;
    }

    if (result.parseErrors.length > 0) {
      const errorPath = path.join(paths.rawResponsesDir, `${caseId}-parse-errors.json`);
      writeJson(errorPath, { caseId, parseErrors: result.parseErrors });
      casePaths.push(relative(options.artifactsDir, errorPath));
    }

    predictions.push({
      caseId,
      prediction: result.value,
      parseAttempts: result.attempts.length,
      parseErrors: result.parseErrors,
      runtimeMs: Date.now() - caseStartedMs,
      usage: result.attempts.reduce<{ inputTokens: number; outputTokens: number } | null>(
        (total, attempt) =>
          attempt.usage === null
            ? total
            : {
                inputTokens: (total?.inputTokens ?? 0) + attempt.usage.inputTokens,
                outputTokens: (total?.outputTokens ?? 0) + attempt.usage.outputTokens,
              },
        null,
      ),
      rawResponsePaths: casePaths,
      promptHash: hashRenderedPrompt(prompt.system, userMessage),
    });

    const assessed = result.value?.requirementAssessments.length ?? 0;
    const failed = result.value?.requirementAssessments.filter((a) => a.status === 'FAIL').length ?? 0;
    options.onProgress?.(
      `${caseId}: ${result.value?.verdict ?? 'UNPARSED'} (${assessed} assessed, ${failed} failed, ${result.attempts.length} attempt(s))`,
    );
  }

  const predictionFile: HardPredictionFile = {
    schemaVersion: '1.0.0',
    runId,
    system: 'baseline',
    dataset: 'phantombench-hard-12',
    split: options.split,
    predictions,
  };
  // Phase boundary: predictions land on disk before any gold file is opened.
  writeJson(paths.predictionPath, predictionFile);

  const manifest = EvaluationRunManifestSchema.parse({
    schemaVersion: '1.0.0',
    runId,
    createdAt: startedAt,
    system: 'baseline',
    stage: 'gate-2.6-hard-development-baseline',
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
    maxRetries: HARD_MAX_REPAIR_ATTEMPTS,
    timeoutPolicy: String(options.client.configuration['timeoutMs'] ?? 'provider default'),
    promptFilePaths: [HARD_PROMPT_REPO_PATH],
    promptHashes: { [HARD_PROMPT_REPO_PATH]: prompt.hash },
    startedAt,
    finishedAt: isoNow(),
    wallClockMs: Date.now() - startedMs,
    modelUsage:
      calls === 0
        ? null
        : {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            calls,
            retries,
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
      'No prediction was hand-corrected.',
      'Requirement-level baseline v2. The v1 prompt and the Core-12 run are untouched.',
    ],
  });
  writeJson(paths.manifestPath, manifest);

  return { runId, paths, predictionFile, manifest };
}
