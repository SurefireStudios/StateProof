import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSERTION_SCHEMA_VERSION, formatRate, type Split } from '@stateproof/core';
import {
  AnthropicModelClient,
  MISSING_CREDENTIALS_MESSAGE,
  ModelCredentialsError,
  hasAnthropicCredentials,
} from '@stateproof/model-provider';
import { ContractBundleError } from '../contract/bundle';
import { CONTRACT_PROMPT_PATH, loadContractPrompt } from '../contract/compiler';
import { DirtySourceTreeError } from '../run/source-guard';
import { WarmContractMissError, runStateProof } from '../stateproof/runner';
import { scoreStateProof } from '../stateproof/score';

/**
 * Cold:
 *   `pnpm benchmark:stateproof-hard -- --split development \
 *      --prompt prompts/contract-agent/v2.md --baseline-run <id>`
 *
 * Warm:
 *   `pnpm benchmark:stateproof-hard -- --split development \
 *      --contracts-from <contractRunId> --baseline-run <id>`
 *
 * Cold compiles one contract per unique task and needs credentials. Warm loads
 * those contracts from disk, verifies their integrity, and needs no credential
 * at all — that is the claim being measured, so the credential check is skipped
 * rather than satisfied. Both refuse the locked split without an explicit gate.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts');
const LOCKED_RUN_ENV = 'STATEPROOF_ALLOW_LOCKED_RUN';

interface CliOptions {
  readonly split: Split;
  readonly artifactsDir: string;
  readonly baselineRunId: string | undefined;
  readonly promptPath: string;
  readonly contractsFrom: string | undefined;
  readonly coldRunId: string | undefined;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let split: Split = 'development';
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;
  let baselineRunId: string | undefined;
  let promptPath = CONTRACT_PROMPT_PATH;
  let contractsFrom: string | undefined;
  let coldRunId: string | undefined;

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
    } else if (arg === '--prompt') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--prompt needs a path');
      promptPath = path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
      index += 1;
    } else if (arg === '--contracts-from') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--contracts-from needs a contract run id');
      contractsFrom = value;
      index += 1;
    } else if (arg === '--cold-run') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--cold-run needs a run id');
      coldRunId = value;
      index += 1;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return { split, artifactsDir, baselineRunId, promptPath, contractsFrom, coldRunId };
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

  const warm = options.contractsFrom !== undefined;
  let client: AnthropicModelClient | null = null;

  if (!warm) {
    if (!hasAnthropicCredentials()) {
      process.stderr.write(`${MISSING_CREDENTIALS_MESSAGE}\n`);
      process.exitCode = 2;
      return;
    }
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
  }

  const prompt = loadContractPrompt(options.promptPath);
  process.stdout.write(`StateProof - split=${options.split} mode=${warm ? 'warm' : 'cold'}\n`);
  process.stdout.write(`assertion schema=${ASSERTION_SCHEMA_VERSION}\n`);
  if (warm) {
    process.stdout.write(`contracts-from=${String(options.contractsFrom)}\n`);
    process.stdout.write('provider=none model=none (no credential is used)\n\n');
  } else {
    process.stdout.write(
      `prompt=${path.relative(REPO_ROOT, options.promptPath).split(path.sep).join('/')} ` +
        `sha256=${prompt.hash}\n`,
    );
    process.stdout.write(
      `provider=${client?.provider ?? 'none'} model=${client?.modelId ?? 'none'}\n`,
    );
    process.stdout.write(`config=${JSON.stringify(client?.configuration ?? {})}\n\n`);
  }

  let run;
  try {
    run =
      warm && options.contractsFrom !== undefined
        ? await runStateProof({
            mode: 'warm',
            contractsFrom: options.contractsFrom,
            split: options.split,
            artifactsDir: options.artifactsDir,
            onProgress: (message) => process.stdout.write(`  ${message}\n`),
          })
        : await runStateProof({
            client: client as AnthropicModelClient,
            split: options.split,
            artifactsDir: options.artifactsDir,
            promptPath: options.promptPath,
            requireCleanSource: true,
            onProgress: (message) => process.stdout.write(`  ${message}\n`),
          });
  } catch (error) {
    if (
      error instanceof DirtySourceTreeError ||
      error instanceof ContractBundleError ||
      error instanceof WarmContractMissError
    ) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  process.stdout.write(
    `\ncontracts:   ${run.compilation.uniqueTaskFingerprints.length} unique task(s), ` +
      `${run.compilation.compilationCalls} compilation call(s), ` +
      `${run.compilation.repairCalls} repair(s), ${run.compilation.cacheHits} cache hit(s)\n`,
  );
  process.stdout.write(`source:      ${run.source.commitSha ?? 'unknown'} `);
  process.stdout.write(`(tracked tree ${run.source.clean ? 'clean' : 'DIRTY'})\n`);
  process.stdout.write(`predictions: ${run.paths.predictionPath}\n`);
  process.stdout.write(`manifest:    ${run.paths.manifestPath}\n`);

  const score = scoreStateProof({
    predictionPath: run.paths.predictionPath,
    artifactsDir: options.artifactsDir,
    manifestPath: run.paths.manifestPath,
    contractArtifacts: run.compilation.artifacts,
    mode: run.mode,
    ...(options.coldRunId === undefined ? {} : { coldRunId: options.coldRunId }),
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
  process.stdout.write(
    `evidence refs ${formatRate(score.evidenceRefValidity)} ` +
      `(${score.evidenceRefCounts[0]}/${score.evidenceRefCounts[1]} resolve)\n`,
  );
  const efficiency = score.efficiency;
  if (efficiency.qualityGuardrailsMet && efficiency.baseline !== null) {
    process.stdout.write(
      `tokens ${efficiency.cold?.totalTokens ?? 0} cold vs baseline ${efficiency.baseline.totalTokens}  ` +
        `(${formatRate(efficiency.modelTokenReduction)} reduction)\n`,
    );
    process.stdout.write(
      efficiency.warm === null
        ? 'warm marginal cost: not measured in this run\n'
        : `warm marginal ${efficiency.warm.totalTokens} tokens, ` +
            `${efficiency.warm.modelCalls} model call(s), break-even ${String(efficiency.breakEvenRuns)} run(s)\n`,
    );
  } else {
    process.stdout.write('no efficiency claim: quality guardrails not met\n');
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
