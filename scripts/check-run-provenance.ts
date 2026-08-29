import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunManifestSchema } from '@stateproof/core';
import { checkPromptProvenance, fileHashAtCommit } from '@stateproof/agents';

/**
 * `pnpm check:provenance <runId>`
 *
 * Verifies after the fact that a run's manifest tells the truth about where it
 * came from: that the tree was clean, and that each prompt it names hashes to
 * the recorded value *at the commit it records* — not at whatever the working
 * copy happens to hold now.
 *
 * Gate 3A's run predates its own commit, so this check fails on it. That is the
 * point: the check is what makes the difference visible rather than a matter of
 * trust.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

function main(): void {
  const runId = process.argv[2];
  if (runId === undefined) {
    process.stderr.write('usage: pnpm check:provenance <runId>\n');
    process.exitCode = 2;
    return;
  }

  const manifestPath = path.join(REPO_ROOT, 'artifacts', 'run-manifests', `${runId}.json`);
  if (!existsSync(manifestPath)) {
    process.stderr.write(`no manifest at ${manifestPath}\n`);
    process.exitCode = 2;
    return;
  }

  const manifest = EvaluationRunManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const problems: string[] = [];

  process.stdout.write(`run:        ${manifest.runId}\n`);
  process.stdout.write(`stage:      ${manifest.stage}\n`);
  process.stdout.write(`commit:     ${manifest.gitCommitSha ?? 'unknown'}\n`);
  process.stdout.write(
    `tree clean: ${manifest.sourceTreeClean === undefined ? 'not recorded' : String(manifest.sourceTreeClean)}\n`,
  );
  process.stdout.write(`assertions: ${manifest.assertionSchemaVersion ?? 'not recorded'}\n`);

  if (manifest.gitCommitSha === null) problems.push('the manifest records no commit');
  if (manifest.sourceTreeClean !== true) {
    problems.push('the manifest does not record a clean tracked source tree');
  }

  for (const promptPath of manifest.promptFilePaths) {
    const expected = manifest.promptHashes[promptPath];
    const actual =
      manifest.gitCommitSha === null
        ? null
        : fileHashAtCommit(manifest.gitCommitSha, promptPath, REPO_ROOT);
    process.stdout.write(
      `prompt:     ${promptPath}\n  recorded ${expected ?? 'none'}\n  at commit ${actual ?? 'not present at that commit'}\n`,
    );
  }

  for (const problem of checkPromptProvenance(manifest, REPO_ROOT)) {
    problems.push(
      `${problem.promptPath}: manifest records ${problem.expectedHash.slice(0, 12)}, ` +
        `commit holds ${problem.actualHash?.slice(0, 12) ?? 'nothing'}`,
    );
  }

  process.stdout.write('\n');
  if (problems.length === 0) {
    process.stdout.write('PROVENANCE OK: this run is re-derivable from its recorded commit.\n');
    return;
  }
  process.stdout.write(`PROVENANCE PROBLEMS (${problems.length}):\n`);
  for (const problem of problems) process.stdout.write(`  - ${problem}\n`);
  process.exitCode = 1;
}

main();
