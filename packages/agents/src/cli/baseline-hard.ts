import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Split } from '@stateproof/core';
import { formatRate } from '@stateproof/core';
import {
  AnthropicModelClient,
  MISSING_CREDENTIALS_MESSAGE,
  ModelCredentialsError,
  hasAnthropicCredentials,
} from '@stateproof/model-provider';
import { runHardBaselinePredictions } from '../baseline/hard-runner';
import { scoreHardPredictions } from '../baseline/hard-score';

/**
 * `pnpm benchmark:baseline-hard -- --split development`
 *
 * The requirement-level baseline over PhantomBench-Hard-12. Same guards as the
 * Core-12 baseline: no credentials means no run and no artifacts, and the
 * locked split is refused unless explicitly unlocked after the freeze.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts');
const LOCKED_RUN_ENV = 'STATEPROOF_ALLOW_LOCKED_RUN';

function parseArgs(argv: readonly string[]): { split: Split; artifactsDir: string } {
  let split: Split = 'development';
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;

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
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return { split, artifactsDir };
}

async function main(): Promise<void> {
  let options: { split: Split; artifactsDir: string };
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

  process.stdout.write(`StateProof hard baseline - split=${options.split}\n`);
  process.stdout.write(`provider=${client.provider} model=${client.modelId}\n`);
  process.stdout.write(`config=${JSON.stringify(client.configuration)}\n\n`);

  const run = await runHardBaselinePredictions({
    client,
    split: options.split,
    artifactsDir: options.artifactsDir,
    onProgress: (message) => process.stdout.write(`  ${message}\n`),
  });

  process.stdout.write(`\npredictions: ${run.paths.predictionPath}\n`);
  process.stdout.write(`manifest:    ${run.paths.manifestPath}\n`);

  const score = scoreHardPredictions({
    predictionPath: run.paths.predictionPath,
    artifactsDir: options.artifactsDir,
    manifestPath: run.paths.manifestPath,
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
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
