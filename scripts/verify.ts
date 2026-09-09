import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledContractV2 } from '@stateproof/core';
import { buildEvidencePack, renderEvidenceMarkdown } from '../apps/product/src/server/evidence';
import {
  ImportError,
  type ImportProblem,
  importRun,
  parseContractDocument,
} from '../apps/product/src/server/importer';
import { buildRunView, readContractArtifact } from '../apps/product/src/server/runs';

/**
 * `pnpm verify <run-package.zip> [options]`
 *
 * Verifies a run package from a shell and writes the same evidence pack the product
 * exports, for evaluation pipelines and CI jobs that cannot drive the import screen.
 *
 * It is the import screen's own code: the same importer, the same contract reader and
 * the same deterministic verifier behind `buildRunView`. Nothing here re-implements a
 * check, so a package that verifies here verifies identically in the product.
 *
 * Read-only, and no model is called. Verification never calls one, and this command
 * will not compile a missing contract — it reports that one is needed and stops.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Exit codes, so a CI job can tell a failed run from a broken invocation. */
const EXIT_OK = 0;
const EXIT_VERDICT = 1;
const EXIT_USAGE = 2;

interface Options {
  readonly packagePath: string;
  readonly contractPath: string | null;
  readonly outDir: string;
  /** NEEDS_REVIEW is a real outcome, so whether it fails the command is the caller's call. */
  readonly failOnNeedsReview: boolean;
}

const USAGE = `stateproof verify — verify a run package and write its evidence pack

  pnpm verify <run-package.zip> [options]

Options
  --contract <file>        compiled contract to verify against, when the package
                           carries none
  --out <directory>        where to write the evidence pack (default: evidence)
  --fail-on-needs-review   exit non-zero on NEEDS_REVIEW as well as FAIL
  -h, --help               show this

Exit codes
  0  PASS (and NEEDS_REVIEW unless --fail-on-needs-review)
  1  FAIL
  2  the package, the contract or the invocation did not validate
`;

function parseArgs(argv: readonly string[]): Options | 'help' {
  let packagePath: string | null = null;
  let contractPath: string | null = null;
  let outDir = 'evidence';
  let failOnNeedsReview = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '-h' || arg === '--help') return 'help';
    if (arg === '--fail-on-needs-review') {
      failOnNeedsReview = true;
      continue;
    }
    if (arg === '--contract' || arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError(`${arg} needs a value`);
      }
      if (arg === '--contract') contractPath = value;
      else outDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
    if (packagePath !== null) throw new UsageError('give exactly one run package');
    packagePath = arg;
  }

  if (packagePath === null) throw new UsageError('a run package is required');
  return { packagePath, contractPath, outDir, failOnNeedsReview };
}

class UsageError extends Error {}

function readPackage(packagePath: string): string {
  try {
    return readFileSync(packagePath).toString('base64');
  } catch (error) {
    throw new UsageError(
      `could not read ${packagePath}: ${error instanceof Error ? error.message : 'unreadable'}`,
    );
  }
}

/** Field-by-field, in the shape the import screen shows them. */
function reportProblems(heading: string, problems: readonly ImportProblem[]): void {
  process.stderr.write(`${heading}\n`);
  for (const problem of problems) {
    process.stderr.write(`  ${problem.field}: ${problem.message}\n`);
  }
}

function main(): number {
  let options: Options | 'help';
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'bad arguments'}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (options === 'help') {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }

  const zipBase64 = readPackage(options.packagePath);

  let imported;
  try {
    ({ imported } = importRun({ zipBase64 }, REPO_ROOT));
  } catch (error) {
    if (error instanceof ImportError) {
      reportProblems('This run package did not validate.', error.problems);
      return EXIT_USAGE;
    }
    throw error;
  }
  for (const warning of imported.warnings) process.stderr.write(`warning: ${warning}\n`);

  // Three legitimate sources, in the order the product prefers them: a contract named
  // on the command line, one shipped inside the package, or the frozen sample contract
  // whose task fingerprint this run reproduces.
  let contract: CompiledContractV2 | null = null;
  let source: 'supplied' | 'package' | 'frozen' = 'supplied';
  let artifact: ReturnType<typeof readContractArtifact> | null = null;

  if (options.contractPath !== null) {
    const problems: ImportProblem[] = [];
    let text: string;
    try {
      text = readFileSync(options.contractPath, 'utf8');
    } catch (error) {
      process.stderr.write(
        `could not read ${options.contractPath}: ${error instanceof Error ? error.message : 'unreadable'}\n`,
      );
      return EXIT_USAGE;
    }
    contract = parseContractDocument(text, options.contractPath, problems);
    if (problems.length > 0 || contract === null) {
      reportProblems('That contract did not validate.', problems);
      return EXIT_USAGE;
    }
  } else if (imported.uploadedContract !== null) {
    contract = imported.uploadedContract;
    source = 'package';
  } else if (imported.matchedContractPath !== null) {
    artifact = readContractArtifact(REPO_ROOT, imported.matchedContractPath);
    contract = artifact.contract;
    source = 'frozen';
  } else {
    reportProblems('No compiled contract is available for this run.', [
      {
        field: 'contract',
        message:
          'pass --contract <file>, or include compiled-contract.json in the package. ' +
          'This command never compiles one, so no model is called.',
      },
    ]);
    return EXIT_USAGE;
  }

  const run =
    source === 'frozen' && artifact !== null
      ? buildRunView({
          label: imported.agentVisible.task.title,
          caseId: null,
          agentVisible: imported.agentVisible,
          contract: artifact.contract,
          contractHash: artifact.contractHash,
          taskFingerprint: artifact.taskFingerprint,
          promptPath: artifact.promptPath,
          promptHash: artifact.promptHash,
          assertionSchemaVersion: artifact.assertionSchemaVersion,
          contractSource: 'frozen-bundle',
          imported: true,
        })
      : buildRunView({
          label: imported.agentVisible.task.title,
          caseId: null,
          agentVisible: imported.agentVisible,
          contract,
          contractHash: 'uploaded-contract',
          taskFingerprint: 'not-computed-for-uploaded-contracts',
          promptPath: options.contractPath ?? 'supplied with the run package',
          promptHash: 'not applicable',
          assertionSchemaVersion: '2.1.0',
          contractSource: 'uploaded',
          imported: true,
        });

  const pack = buildEvidencePack(run);
  const outDir = path.resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `evidence-${run.runId}.json`);
  const markdownPath = path.join(outDir, `evidence-${run.runId}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderEvidenceMarkdown(pack), 'utf8');

  const verdict = run.verdict;
  process.stdout.write(`run:      ${run.runId}\n`);
  process.stdout.write(`task:     ${run.label}\n`);
  process.stdout.write(`contract: ${source}\n`);
  process.stdout.write(`verdict:  ${verdict}\n\n`);
  for (const requirement of run.requirements) {
    const mark =
      requirement.status === 'PASS' ? 'ok  ' : requirement.status === 'FAIL' ? 'FAIL' : 'rvw ';
    process.stdout.write(`  ${mark} ${requirement.requirementKey}  ${requirement.description}\n`);
  }
  process.stdout.write(`\nevidence: ${jsonPath}\n          ${markdownPath}\n`);

  if (verdict === 'FAIL') return EXIT_VERDICT;
  if (verdict === 'NEEDS_REVIEW' && options.failOnNeedsReview) return EXIT_VERDICT;
  return EXIT_OK;
}

process.exitCode = main();
