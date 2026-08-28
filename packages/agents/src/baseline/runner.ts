import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  type EvaluationRunManifest,
  EvaluationRunManifestSchema,
  type Split,
  sha256Hex,
  toJsonValue,
} from '@stateproof/core';
import {
  CASES_DIR,
  REPO_ROOT,
  caseIdsForSplit,
  hashAgentVisibleCase,
  loadAgentVisibleCase,
} from '@stateproof/benchmark';
import { type ModelClient, requestStructured } from '@stateproof/model-provider';
import {
  type BaselineCasePrediction,
  type BaselinePredictionFile,
  BaselinePredictionSchema,
} from './schema';
import {
  BASELINE_PROMPT_REPO_PATH,
  hashRenderedPrompt,
  loadBaselinePrompt,
  renderBaselineUserMessage,
} from './prompt';

/**
 * Phase 1 of the baseline: predict.
 *
 * The ordering rule is structural, not a comment: this module imports only the
 * agent-visible loader and the split list. Gold data is loaded by `score.ts`,
 * after the prediction artifact has been written to disk.
 */

export const MAX_REPAIR_ATTEMPTS = 1;

export interface BaselineRunPaths {
  readonly artifactsDir: string;
  readonly rawResponsesDir: string;
  readonly predictionPath: string;
  readonly manifestPath: string;
}

export interface BaselineRunOptions {
  readonly client: ModelClient;
  readonly split: Split;
  readonly artifactsDir: string;
  readonly casesDir?: string;
  readonly promptPath?: string;
  readonly runId?: string;
  readonly onProgress?: (message: string) => void;
}

export interface BaselineRunResult {
  readonly runId: string;
  readonly paths: BaselineRunPaths;
  readonly predictionFile: BaselinePredictionFile;
  readonly manifest: EvaluationRunManifest;
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, (match) => match);
}

export function makeRunId(split: Split, mode: 'live' | 'replay'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `RUN-baseline-${split}-${mode}-${stamp}`;
}

/** sha256 of the lockfile, so a run records the dependency tree it used. */
function packageLockHash(): string | null {
  const lockPath = path.join(REPO_ROOT, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) return null;
  return sha256Hex(readFileSync(lockPath, 'utf8'));
}

function gitCommitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function runPaths(artifactsDir: string, runId: string): BaselineRunPaths {
  return {
    artifactsDir,
    rawResponsesDir: path.join(artifactsDir, 'model-responses', runId),
    predictionPath: path.join(artifactsDir, 'predictions', `${runId}.json`),
    manifestPath: path.join(artifactsDir, 'run-manifests', `${runId}.json`),
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(toJsonValue(value), null, 2)}\n`, 'utf8');
}

/**
 * Runs the baseline over one split and writes the prediction artifacts.
 * Predictions are never adjusted by hand, and a case whose output never
 * validated is recorded with `prediction: null` rather than being dropped.
 */
export async function runBaselinePredictions(
  options: BaselineRunOptions,
): Promise<BaselineRunResult> {
  const casesDir = options.casesDir ?? CASES_DIR;
  const runId = options.runId ?? makeRunId(options.split, 'live');
  const paths = runPaths(options.artifactsDir, runId);
  const prompt = loadBaselinePrompt(options.promptPath);
  const startedAt = isoNow();
  const startedMs = Date.now();

  const caseIds = caseIdsForSplit(options.split);
  const predictions: BaselineCasePrediction[] = [];
  const agentVisibleHashes: string[] = [];
  const rawResponsePaths: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let calls = 0;
  let retries = 0;

  for (const caseId of caseIds) {
    // Agent-visible only. Nothing on this path can reach gold data.
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir });
    agentVisibleHashes.push(hashAgentVisibleCase(agentVisible));
    const userMessage = renderBaselineUserMessage(prompt, agentVisible);
    const caseStartedMs = Date.now();

    const result = await requestStructured({
      client: options.client,
      system: prompt.system,
      userMessage,
      schema: BaselinePredictionSchema,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    });

    const casePaths: string[] = [];
    for (const attempt of result.attempts) {
      const attemptPath = path.join(
        paths.rawResponsesDir,
        `${caseId}-attempt-${attempt.attempt}.json`,
      );
      writeJson(attemptPath, attempt);
      const relative = path.relative(options.artifactsDir, attemptPath).split(path.sep).join('/');
      casePaths.push(relative);
      rawResponsePaths.push(relative);

      calls += 1;
      if (attempt.kind === 'repair') retries += 1;
      totalInputTokens += attempt.usage?.inputTokens ?? 0;
      totalOutputTokens += attempt.usage?.outputTokens ?? 0;
    }

    if (result.parseErrors.length > 0) {
      const errorPath = path.join(paths.rawResponsesDir, `${caseId}-parse-errors.json`);
      writeJson(errorPath, { caseId, parseErrors: result.parseErrors });
      casePaths.push(path.relative(options.artifactsDir, errorPath).split(path.sep).join('/'));
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

    options.onProgress?.(
      `${caseId}: ${result.value?.verdict ?? 'UNPARSED'} (${result.attempts.length} attempt(s))`,
    );
  }

  const predictionFile: BaselinePredictionFile = {
    schemaVersion: '1.0.0',
    runId,
    system: 'baseline',
    split: options.split,
    predictions,
  };
  // Phase boundary: predictions are on disk before any gold file is opened.
  writeJson(paths.predictionPath, predictionFile);

  const finishedAt = isoNow();
  const manifest: EvaluationRunManifest = EvaluationRunManifestSchema.parse({
    schemaVersion: '1.0.0',
    runId,
    createdAt: startedAt,
    system: 'baseline',
    stage: 'gate-2-development-baseline',
    mode: 'live',
    gitCommitSha: gitCommitSha(),
    runtimeVersion: `node-${process.versions.node}`,
    packageLockHash: packageLockHash(),
    datasetName: 'phantombench-12',
    // Fingerprints only what the model was shown. The gold-inclusive hash is
    // filled in by the scoring phase, so the prediction phase never has a
    // reason to open a gold file.
    agentVisibleDatasetHash: sha256Hex(agentVisibleHashes.join('|')),
    datasetHash: null,
    splits: [options.split],
    caseIds,
    modelProvider: options.client.provider,
    modelId: options.client.modelId,
    modelConfiguration: options.client.configuration,
    maxRetries: MAX_REPAIR_ATTEMPTS,
    timeoutPolicy: String(options.client.configuration['timeoutMs'] ?? 'provider default'),
    promptFilePaths: [BASELINE_PROMPT_REPO_PATH],
    promptHashes: { [BASELINE_PROMPT_REPO_PATH]: prompt.hash },
    startedAt,
    finishedAt,
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
    trajectoryPaths: caseIds.map((caseId) => `benchmarks/phantombench-12/cases/${caseId}/trajectory.jsonl`),
    predictionPath: path.relative(options.artifactsDir, paths.predictionPath).split(path.sep).join('/'),
    reportPath: null,
    notes: [
      'Predictions were written before any gold file was read.',
      'No prediction was hand-corrected.',
      'agentVisibleDatasetHash covers only what the model was shown; datasetHash and reportPath are completed by the scoring phase.',
    ],
  });
  writeJson(paths.manifestPath, manifest);

  return { runId, paths, predictionFile, manifest };
}
