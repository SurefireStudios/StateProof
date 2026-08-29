import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRate } from '@stateproof/core';
import { HARD_CASES_DIR, HARD_SPLITS_DIR, onCaseFileRead } from '@stateproof/benchmark';
import { runStateProof, scoreStateProof } from '@stateproof/agents';
import {
  SubmissionArtifactError,
  canonicalPredictionFileHash,
  loadSubmissionView,
} from '@stateproof/submission';

/**
 * `pnpm reproduce` — the whole result, re-derived, with no API key.
 *
 * This is the claim StateProof makes about itself: a compiled contract is a
 * durable artifact, so anyone can re-run the verification and get the same
 * verdicts without paying a model or trusting our word for it. If that is true,
 * this command reproduces the Gate 3C warm run byte for byte. If it is not, it
 * fails — there is no partial-credit path here.
 *
 * `pnpm reproduce:check` runs everything except the re-verification, for a
 * fast artifact/provenance audit.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACTS = path.join(REPO_ROOT, 'artifacts');
const CREDENTIAL_VARS = ['STATEPROOF_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] as const;

interface Step {
  readonly name: string;
  readonly detail: string;
}

const steps: Step[] = [];
const failures: string[] = [];

function ok(name: string, detail: string): void {
  steps.push({ name, detail });
  process.stdout.write(`  ok    ${name.padEnd(46)} ${detail}\n`);
}

function fail(name: string, detail: string): void {
  failures.push(`${name}: ${detail}`);
  process.stdout.write(`  FAIL  ${name.padEnd(46)} ${detail}\n`);
}

function check(name: string, condition: boolean, detail: string): void {
  if (condition) ok(name, detail);
  else fail(name, detail);
}

function runCli(script: string, args: readonly string[]): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(REPO_ROOT, script), ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function promptHashAtCommit(commitSha: string, repoRelativePath: string): string | null {
  try {
    // stderr is silenced: the one expected miss here is the documented Gate 3A
    // provenance defect, and git's fatal line would read like a crash.
    return execFileSync('git', ['show', `${commitSha}:${repoRelativePath}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check-only');
  process.stdout.write(
    [
      'StateProof reproduction',
      '',
      `mode:        ${checkOnly ? 'artifact + provenance check only' : 'full replay'}`,
      `credentials: ${CREDENTIAL_VARS.filter((name) => process.env[name] !== undefined).length === 0 ? 'none present' : 'present in environment (they will not be used)'}`,
      '',
    ].join('\n'),
  );

  // --- 1. the benchmarks themselves ----------------------------------------
  for (const [label, script] of [
    ['Core-12 fixtures validate', 'packages/benchmark/src/cli/validate.ts'],
    ['Hard-12 fixtures validate', 'packages/benchmark/src/cli/validate-hard.ts'],
  ] as const) {
    const result = runCli(script, []);
    check(label, result.code === 0 && result.output.includes('RESULT: PASSED'), result.code === 0 ? 'PASSED' : 'validator failed');
  }

  // --- 2. the pinned artifact registry -------------------------------------
  let view;
  try {
    view = loadSubmissionView({
      repoRoot: REPO_ROOT,
      checkProvenance: (commitSha, promptPath) => {
        const blob = promptHashAtCommit(commitSha, promptPath);
        return blob === null ? `${promptPath} is not present at ${commitSha.slice(0, 12)}` : null;
      },
    });
  } catch (error) {
    if (error instanceof SubmissionArtifactError) {
      for (const problem of error.problems) fail('pinned artifacts', problem);
      process.stdout.write('\nRESULT: FAILED\n');
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  ok('reproduction manifest validates', `${view.runs.length} runs, ${view.prompts.length} prompts`);
  ok(
    'pinned artifacts verify',
    `${view.bundles[0]?.contracts.length ?? 0} contracts, every hash re-derived`,
  );

  // --- 3. locked cases are unreachable -------------------------------------
  const lockedIds = new Set(view.manifest.lockedCaseIds);
  const replayIds = view.manifest.replayCaseIds;
  check(
    'no locked case is registered or replayed',
    replayIds.every((caseId) => !lockedIds.has(caseId)),
    `${replayIds.length} development case(s), ${lockedIds.size} locked case(s) excluded`,
  );

  const target = view.replayTarget;
  const bundle = view.bundles[0];
  if (bundle === undefined) {
    fail('contract bundle', 'no contract bundle is registered');
    process.stdout.write('\nRESULT: FAILED\n');
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    finish();
    return;
  }

  // --- 4. re-verify the eight development cases ----------------------------
  const scratch = mkdtempSync(path.join(tmpdir(), 'stateproof-reproduce-'));
  const predictionPath = path.join(scratch, 'predictions', 'RUN-reproduce.json');
  // Two different questions. Reading a locked fixture to compute the
  // gold-inclusive dataset hash is legitimate and happens during scoring; a
  // locked case reaching the prediction phase would mean it was evaluated.
  const lockedBeforePredictions: string[] = [];
  const stopObserving = onCaseFileRead(({ caseDir }) => {
    const caseId = path.basename(caseDir);
    if (lockedIds.has(caseId) && !existsSync(predictionPath)) lockedBeforePredictions.push(caseId);
  });

  try {
    const replay = await runStateProof({
      mode: 'warm',
      contractsFrom: bundle.registered.contractRunId,
      contractsArtifactsDir: ARTIFACTS,
      split: 'development',
      artifactsDir: scratch,
      runId: 'RUN-reproduce',
      casesDir: HARD_CASES_DIR,
      splitsDir: HARD_SPLITS_DIR,
    });

    check(
      'replay makes zero model calls',
      replay.compilation.compilationCalls === 0 && replay.manifest.modelUsage === null,
      `${replay.compilation.compilationCalls} call(s), modelUsage ${String(replay.manifest.modelUsage)}`,
    );
    check(
      'replay spends zero model tokens',
      replay.compilation.inputTokens + replay.compilation.outputTokens === 0,
      '0 input, 0 output',
    );
    check(
      'replay writes no raw model response',
      !existsSync(path.join(scratch, 'model-responses')),
      'no model-responses directory created',
    );
    check(
      'every case reused a persisted contract',
      replay.predictionFile.predictions.every((entry) => entry.cacheHit),
      `${replay.predictionFile.predictions.length}/${replay.predictionFile.predictions.length} cache hits`,
    );

    // Canonical predictions must equal the pinned Gate 3C warm run exactly.
    const replayHash = canonicalPredictionFileHash(
      JSON.parse(readFileSync(replay.paths.predictionPath, 'utf8')),
    );
    check(
      'predictions are byte-identical to the pinned warm run',
      replayHash === target.canonicalPredictionSha256,
      `sha256 ${replayHash.slice(0, 16)}`,
    );

    const pinnedHashes = new Map(
      (target.predictionFile as { predictions: Array<{ caseId: string; contractHash: string }> })
        .predictions.map((entry) => [entry.caseId, entry.contractHash]),
    );
    check(
      'contract hashes match the pinned run',
      replay.predictionFile.predictions.every(
        (entry) => pinnedHashes.get(entry.caseId) === entry.contractHash,
      ),
      `${pinnedHashes.size} case(s) compared`,
    );

    // Scoring reads gold, and only after the predictions exist on disk.
    const score = scoreStateProof({
      predictionPath: replay.paths.predictionPath,
      artifactsDir: scratch,
      manifestPath: replay.paths.manifestPath,
      contractArtifacts: replay.compilation.artifacts,
      mode: 'warm',
      usage: {
        contractCalls: 0,
        repairCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        compilationWallMs: replay.compilation.wallClockMs,
        verificationWallMs: replay.verificationMs,
        cacheHits: replay.compilation.cacheHits,
      },
    });

    const expected = target;
    check(
      'quality metrics match the pinned report',
      score.requirementMetrics.safetyViolationRecall === expected.svr &&
        score.requirementMetrics.falseViolationRate === expected.fvr &&
        score.requirementMetrics.completeDiagnosisRate === expected.cdr &&
        score.verdictMetrics.balancedVerdictAccuracy === expected.bva,
      `SVR ${formatRate(score.requirementMetrics.safetyViolationRecall)}, ` +
        `FVR ${formatRate(score.requirementMetrics.falseViolationRate)}, ` +
        `CDR ${formatRate(score.requirementMetrics.completeDiagnosisRate)}, ` +
        `BVA ${formatRate(score.verdictMetrics.balancedVerdictAccuracy)}`,
    );
    check(
      'every evidence reference resolves',
      score.evidenceRefValidity === 1,
      `${score.evidenceRefCounts[0]}/${score.evidenceRefCounts[1]}`,
    );
    check(
      'no locked case reached the prediction phase',
      lockedBeforePredictions.length === 0,
      lockedBeforePredictions.length === 0
        ? 'none — locked fixtures are only read later, for the dataset hash'
        : [...new Set(lockedBeforePredictions)].join(', '),
    );
    check(
      'only development cases were scored',
      score.caseResults.map((row) => row.caseId).sort().join(',') === [...replayIds].sort().join(','),
      `${score.caseResults.length} case(s)`,
    );
    check(
      'no partial requirement remains',
      replay.compilation.artifacts.every((artifact) =>
        artifact.contract.requirements.every(
          (requirement) => requirement.verificationCoverage === 'complete',
        ),
      ),
      'all requirements declare complete coverage',
    );

    process.stdout.write(
      [
        '',
        'Reproduced from the committed contract bundle:',
        `  contract bundle    ${bundle.registered.contractRunId}`,
        `  pinned warm run    ${target.registered.id}`,
        `  cases              ${replay.predictionFile.predictions.length} hard-development`,
        `  model calls        0 (baseline needed ${view.byRole.get('baseline-hard')?.[0]?.modelCalls ?? 0})`,
        `  model tokens       0 (baseline needed ${view.byRole.get('baseline-hard')?.[0]?.totalTokens ?? 0})`,
        `  verification time  ${replay.verificationMs} ms`,
        `  SVR / FVR / CDR    ${formatRate(score.requirementMetrics.safetyViolationRecall)} / ` +
          `${formatRate(score.requirementMetrics.falseViolationRate)} / ` +
          `${formatRate(score.requirementMetrics.completeDiagnosisRate)}`,
        `  BVA                ${formatRate(score.verdictMetrics.balancedVerdictAccuracy)}`,
        '',
      ].join('\n'),
    );
  } finally {
    stopObserving();
    rmSync(scratch, { recursive: true, force: true });
  }

  finish();
}

function finish(): void {
  if (failures.length === 0) {
    process.stdout.write(`RESULT: PASSED (${steps.length} checks)\n`);
    return;
  }
  process.stdout.write(`\nRESULT: FAILED (${failures.length} of ${steps.length + failures.length} checks)\n`);
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
