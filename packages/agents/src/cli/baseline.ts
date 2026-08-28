import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Split } from '@stateproof/core';
import {
  AnthropicModelClient,
  MISSING_CREDENTIALS_MESSAGE,
  ModelCredentialsError,
  hasAnthropicCredentials,
} from '@stateproof/model-provider';
import { runBaselinePredictions } from '../baseline/runner';
import { scorePredictions } from '../baseline/score';

/**
 * `pnpm benchmark:baseline -- --split development`
 *
 * Runs the fair baseline over one split, writes prediction artifacts, then
 * scores them against gold in a separate phase.
 *
 * Two guards matter here:
 *   - with no credentials the command exits with an actionable message and
 *     writes nothing. A baseline run is never simulated.
 *   - the locked split is gated behind an explicit environment variable, so an
 *     intermediate run cannot touch the challenge cases by accident.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts');
const LOCKED_RUN_ENV = 'STATEPROOF_ALLOW_LOCKED_RUN';

interface CliOptions {
  readonly split: Split;
  readonly artifactsDir: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let split: Split = 'development';
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // pnpm forwards the `--` separator through to the script; ignore it.
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
        'Refusing to run the locked challenge split.',
        '',
        'The locked cases are held back from all tuning until the baseline prompt,',
        'the StateProof prompts, the assertion code and the model configuration are',
        'frozen. Running them now would spend the one comparison they exist for.',
        '',
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

  process.stdout.write(`StateProof baseline - split=${options.split}\n`);
  process.stdout.write(`provider=${client.provider} model=${client.modelId}\n`);
  process.stdout.write(`config=${JSON.stringify(client.configuration)}\n\n`);

  // No gold file is opened before the predictions are on disk, so the dataset
  // fingerprint used here covers agent-visible content only. The gold-inclusive
  // hash is recorded by the scoring phase below.
  const run = await runBaselinePredictions({
    client,
    split: options.split,
    artifactsDir: options.artifactsDir,
    onProgress: (message) => process.stdout.write(`  ${message}\n`),
  });

  process.stdout.write(`\npredictions: ${run.paths.predictionPath}\n`);
  process.stdout.write(`manifest:    ${run.paths.manifestPath}\n`);

  const score = scorePredictions({
    predictionPath: run.paths.predictionPath,
    artifactsDir: options.artifactsDir,
  });

  process.stdout.write(`report:      ${score.reportMarkdownPath}\n\n`);
  process.stdout.write(
    `BVA ${score.metrics.balancedVerdictAccuracy === null ? 'n/a' : (score.metrics.balancedVerdictAccuracy * 100).toFixed(1)}%  ` +
      `(${score.metrics.correctCount}/${score.metrics.caseCount} correct)\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
