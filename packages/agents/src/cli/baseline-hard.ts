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
import {
  type FinalLockedApproval,
  FinalLockedProtocolError,
  assertFinalLockedProtocol,
  recordCompleted,
  recordFailed,
  recordStarted,
} from '../run/final-lock';

/**
 * `pnpm benchmark:baseline-hard -- --split development`
 *
 * The requirement-level baseline over PhantomBench-Hard-12. No credentials
 * means no run and no artifacts; the locked split additionally requires the
 * one-time final-lock protocol, which is the only way it can ever be run.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts');

interface CliOptions {
  readonly split: Split;
  readonly artifactsDir: string;
  readonly finalLocked: boolean;
  readonly expectedFreeze: string | undefined;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let split: Split = 'development';
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;
  let finalLocked = false;
  let expectedFreeze: string | undefined;

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
    } else if (arg === '--final-locked') {
      finalLocked = true;
    } else if (arg === '--expected-freeze') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--expected-freeze needs a full commit sha');
      expectedFreeze = value;
      index += 1;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return { split, artifactsDir, finalLocked, expectedFreeze };
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

  // The locked split has no casual mode: either the full one-time protocol
  // holds, or the four held-out cases are never opened.
  let approval: FinalLockedApproval | null = null;
  if (options.split === 'locked') {
    try {
      approval = assertFinalLockedProtocol({
        workflow: 'baseline-hard-locked',
        split: options.split,
        finalLocked: options.finalLocked,
        expectedFreeze: options.expectedFreeze,
        dataset: 'phantombench-hard-12',
        repoRoot: REPO_ROOT,
      });
    } catch (error) {
      if (error instanceof FinalLockedProtocolError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 2;
        return;
      }
      throw error;
    }
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
  process.stdout.write(`config=${JSON.stringify(client.configuration)}\n`);
  if (approval !== null) {
    process.stdout.write(`FINAL LOCKED RUN - freeze ${approval.freezeCommit}\n`);
    recordStarted(approval, 'locked baseline evaluation starting');
  }
  process.stdout.write('\n');

  let run;
  try {
    run = await runHardBaselinePredictions({
      client,
      split: options.split,
      artifactsDir: options.artifactsDir,
      onProgress: (message) => process.stdout.write(`  ${message}\n`),
    });
  } catch (error) {
    // A failed attempt stays in the ledger. Erasing it would leave a record
    // that looks like a clean first try.
    if (approval !== null) {
      recordFailed(approval, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }

  if (approval !== null) {
    recordCompleted(approval, run.runId, 'locked baseline predictions persisted');
  }

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
