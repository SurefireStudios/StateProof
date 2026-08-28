import { HARD_BENCHMARK_NAME, HARD_CASES_DIR } from '../paths';
import { hardApprovedCase } from '../validate/hard-cases';
import { disprovenKeys, validateHardBenchmark } from '../validate/hard';

/**
 * `pnpm benchmark:validate-hard`
 *
 * Offline validation of every PhantomBench-Hard-12 fixture, including the
 * failure structure each invalid case is required to exhibit. Exits non-zero
 * on any error-level issue.
 */
function main(): void {
  const startedAt = process.hrtime.bigint();
  const report = validateHardBenchmark(HARD_CASES_DIR);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  process.stdout.write(`StateProof fixture validation - ${HARD_BENCHMARK_NAME}\n`);
  process.stdout.write(`cases directory: ${HARD_CASES_DIR}\n`);
  process.stdout.write(`dataset hash:    ${report.datasetHash}\n\n`);

  for (const caseReport of report.caseReports) {
    const errors = caseReport.issues.filter((entry) => entry.severity === 'error');
    const approved = hardApprovedCase(caseReport.caseId);
    const keys = disprovenKeys(caseReport);

    process.stdout.write(
      `${errors.length === 0 ? 'OK  ' : 'FAIL'} ${caseReport.caseId}  ` +
        `split=${approved?.split ?? '?'}  verdict=${caseReport.computedVerdict.overall}  ` +
        `failed=${keys.length}  hash=${caseReport.agentVisibleHash.slice(0, 12)}\n`,
    );
    if (keys.length > 0) {
      process.stdout.write(`       keys: ${keys.join(', ')}\n`);
    }
    for (const entry of caseReport.issues) {
      process.stdout.write(`       ! ${entry.severity} (${entry.check}) ${entry.message}\n`);
    }
  }

  process.stdout.write('\n');
  for (const entry of report.issues) {
    process.stdout.write(`! ${entry.severity} (${entry.check}) ${entry.caseId}: ${entry.message}\n`);
  }

  const errorCount =
    report.issues.filter((entry) => entry.severity === 'error').length +
    report.caseReports.reduce(
      (total, caseReport) =>
        total + caseReport.issues.filter((entry) => entry.severity === 'error').length,
      0,
    );

  process.stdout.write(
    `${report.caseReports.length} case(s) validated, ${errorCount} error(s), ${durationMs.toFixed(1)} ms\n`,
  );
  if (!report.ok) {
    process.stdout.write('RESULT: FAILED\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('RESULT: PASSED\n');
}

main();
