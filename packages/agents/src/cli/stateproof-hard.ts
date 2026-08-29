import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRate, type Split } from '@stateproof/core';
import {
  AnthropicModelClient,
  MISSING_CREDENTIALS_MESSAGE,
  ModelCredentialsError,
  hasAnthropicCredentials,
} from '@stateproof/model-provider';
import { runStateProof } from '../stateproof/runner';
import { scoreStateProof } from '../stateproof/score';

/**
 * `pnpm benchmark:stateproof-hard -- --split development --baseline-run <id>`
 *
 * Compiles one contract per unique task, then verifies every run with
 * deterministic code. Same credential and locked-split guards as every other
 * runner: no key means no run and no artifacts.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts');
const LOCKED_RUN_ENV = 'STATEPROOF_ALLOW_LOCKED_RUN';

interface CliOptions {
  readonly split: Split;
  readonly artifactsDir: string;
  readonly baselineRunId: string | undefined;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let split: Split = 'development';
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;
  let baselineRunId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--split') {
      const value = argv[index + 1];
      if (value !== 'development' && value !== 'locked') {
        throw new Error(`--split must be "development" or "locked", received "${String(value)}"`);
      }
      split = value;
      index += 1;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--out needs a directory');
      artifactsDir = path.resolve(value);
      index += 1;
    } else if (arg === '--baseline-run') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--baseline-run needs a run id');
      baselineRunId = value;
      index += 1;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return { split, artifactsDir, baselineRunId };
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.split === 'locked' && process.env[LOCKED_RUN_ENV] !== '1') {
    process.stderr.write(
      [
        'Refusing to run the hard locked challenge split.',
        '',
        'These four cases are the one comparison the final system is measured by.',
        `If the freeze has genuinely happened, set ${LOCKED_RUN_ENV}=1 and re-run.`,
        '',
      ].join('\n'),
    );
    process.exitCode = 2;
    return;
  }

  if (!hasAnthropicCredentials()) {
    process.stderr.write(`${MISSING_CREDENTIALS_MESSAGE}\n`);
    process.exitCode = 2;
    return;
  }

  let client: AnthropicModelClient;
  try {
    client = new AnthropicModelClient();
  } catch (error) {
    if (error instanceof ModelCredentialsError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  process.stdout.write(`StateProof - split=${options.split}\n`);
  process.stdout.write(`provider=${client.provider} model=${client.modelId}\n`);
  process.stdout.write(`config=${JSON.stringify(client.configuration)}\n\n`);

  const run = await runStateProof({
    client,
    split: options.split,
    artifactsDir: options.artifactsDir,
    onProgress: (message) => process.stdout.write(`  ${message}\n`),
  });

  process.stdout.write(
    `\ncontracts:   ${run.compilation.uniqueTaskFingerprints.length} unique task(s), ` +
      `${run.compilation.compilationCalls} compilation call(s), ` +
      `${run.compilation.repairCalls} repair(s), ${run.compilation.cacheHits} cache hit(s)\n`,
  );
  process.stdout.write(`predictions: ${run.paths.predictionPath}\n`);
  process.stdout.write(`manifest:    ${run.paths.manifestPath}\n`);

  const score = scoreStateProof({
    predictionPath: run.paths.predictionPath,
    artifactsDir: options.artifactsDir,
    manifestPath: run.paths.manifestPath,
    contractArtifacts: run.compilation.artifacts,
    ...(options.baselineRunId === undefined ? {} : { baselineRunId: options.baselineRunId }),
    usage: {
      contractCalls: run.compilation.compilationCalls,
      repairCalls: run.compilation.repairCalls,
      inputTokens: run.compilation.inputTokens,
      outputTokens: run.compilation.outputTokens,
      compilationWallMs: run.compilation.wallClockMs,
      verificationWallMs: run.verificationMs,
      cacheHits: run.compilation.cacheHits,
    },
  });

  const requirement = score.requirementMetrics;
  process.stdout.write(`report:      ${score.reportMarkdownPath}\n\n`);
  process.stdout.write(
    `SVR ${formatRate(requirement.safetyViolationRecall)} ` +
      `(${requirement.safetyViolationCounts[0]}/${requirement.safetyViolationCounts[1]})  ` +
      `FVR ${formatRate(requirement.falseViolationRate)} ` +
      `(${requirement.falseViolationCounts[0]}/${requirement.falseViolationCounts[1]})  ` +
      `CDR ${formatRate(requirement.completeDiagnosisRate)} ` +
      `(${requirement.completeDiagnosisCounts[0]}/${requirement.completeDiagnosisCounts[1]})  ` +
      `BVA ${formatRate(score.verdictMetrics.balancedVerdictAccuracy)}\n`,
  );
  if (score.efficiency.qualityGuardrailsMet && score.efficiency.baseline !== null) {
    process.stdout.write(
      `tokens ${score.efficiency.stateproof.totalTokens} vs baseline ${score.efficiency.baseline.totalTokens}  ` +
        `(${formatRate(score.efficiency.modelTokenReduction)} reduction)  ` +
        `warm marginal ${score.efficiency.warmMarginalTokens} tokens\n`,
    );
  } else {
    process.stdout.write('no efficiency claim: quality guardrails not met\n');
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
