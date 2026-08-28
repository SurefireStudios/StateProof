import { BENCHMARK_NAME, CASES_DIR } from '../paths';
import { validateBenchmark } from '../validate';

/**
 * `pnpm benchmark:validate`
 *
 * Deterministic, offline validation of every PhantomBench fixture. No provider
 * key, no network, no model call. Exits non-zero on any error-level issue.
 */
function main(): void {
  const startedAt = process.hrtime.bigint();
  const report = validateBenchmark(CASES_DIR);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  process.stdout.write(`StateProof fixture validation - ${BENCHMARK_NAME}\n`);
  process.stdout.write(`cases directory: ${CASES_DIR}\n`);
  process.stdout.write(`dataset hash:    ${report.datasetHash}\n\n`);

  for (const caseReport of report.caseReports) {
    const errors = caseReport.issues.filter((issue) => issue.severity === 'error');
    const warnings = caseReport.issues.filter((issue) => issue.severity === 'warning');
    const marker = errors.length === 0 ? 'OK  ' : 'FAIL';

    process.stdout.write(
      `${marker} ${caseReport.caseId}  verdict=${caseReport.computedVerdict.overall}  hash=${caseReport.agentVisibleHash.slice(0, 12)}\n`,
    );

    for (const verdict of caseReport.computedVerdict.requirementVerdicts) {
      const flag = verdict.mustPass ? 'must-pass' : 'advisory ';
      process.stdout.write(
        `       - ${verdict.requirementId} [${flag}] ${verdict.status}: ${verdict.rationale}\n`,
      );
    }
    for (const issue of [...errors, ...warnings]) {
      process.stdout.write(`       ! ${issue.severity} (${issue.check}) ${issue.message}\n`);
    }
    process.stdout.write('\n');
  }

  for (const issue of report.issues) {
    process.stdout.write(`! ${issue.severity} (${issue.check}) ${issue.caseId}: ${issue.message}\n`);
  }

  const caseErrorCount = report.caseReports.reduce(
    (total, caseReport) =>
      total + caseReport.issues.filter((issue) => issue.severity === 'error').length,
    0,
  );
  const globalErrorCount = report.issues.filter((issue) => issue.severity === 'error').length;
  const errorCount = caseErrorCount + globalErrorCount;

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
