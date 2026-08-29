import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunManifestSchema, formatRate } from '@stateproof/core';

/**
 * `pnpm compare:development <label>=<runId> ...`
 *
 * Builds the development comparison table from the run artifacts themselves.
 *
 * Every number here is read out of a manifest or a report that some run
 * actually produced. Nothing is typed in, which is the only way a headline
 * table stays true after the next iteration changes something.
 */

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACTS = path.join(REPO_ROOT, 'artifacts');

interface Column {
  readonly label: string;
  readonly runId: string;
  readonly modelCalls: number | null;
  readonly repairCalls: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly wallClockMs: number | null;
  readonly verificationMs: number | null;
  readonly cacheHits: number | null;
  readonly svr: number | null;
  readonly fvr: number | null;
  readonly cdr: number | null;
  readonly bva: number | null;
  readonly evidenceValidity: number | null;
  readonly partialRequirements: number | null;
}

interface ReportJson {
  requirementMetrics?: {
    safetyViolationRecall: number | null;
    falseViolationRate: number | null;
    completeDiagnosisRate: number | null;
  };
  verdictMetrics?: { balancedVerdictAccuracy: number | null };
  evidenceRefValidity?: number | null;
  efficiency?: {
    stateproof?: { verificationWallMs?: number; cacheHits?: number };
  };
  contractCoverage?: Array<{ partialRequirements?: number }>;
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

/** Counts requirements a run's own contracts declared as partially covered. */
function partialRequirements(contractRunId: string | undefined): number | null {
  if (contractRunId === undefined) return null;
  const dir = path.join(ARTIFACTS, 'contracts', contractRunId);
  if (!existsSync(dir)) return null;
  let partial = 0;
  for (const file of readdirSync(dir)) {
    const artifact = readJson<{
      contract: { requirements: Array<{ verificationCoverage?: string }> };
    }>(path.join(dir, file));
    if (artifact === null) continue;
    for (const requirement of artifact.contract.requirements) {
      if (requirement.verificationCoverage === 'partial') partial += 1;
    }
  }
  return partial;
}

function columnFor(label: string, runId: string): Column {
  const manifest = readJson<unknown>(path.join(ARTIFACTS, 'run-manifests', `${runId}.json`));
  if (manifest === null) throw new Error(`no manifest for ${runId}`);
  const parsed = EvaluationRunManifestSchema.parse(manifest);
  const report = readJson<ReportJson>(path.join(ARTIFACTS, 'reports', `${runId}.json`));

  const usage = parsed.modelUsage;
  const requirement = report?.requirementMetrics;
  // Runs written before the manifest carried a contract run id still name it
  // in their prediction file, so historical columns stay comparable.
  const prediction = readJson<{ contractRunId?: string }>(
    path.join(ARTIFACTS, 'predictions', `${runId}.json`),
  );
  const contractRunId =
    parsed.contractRunId ?? parsed.sourceContractRunId ?? prediction?.contractRunId ?? undefined;

  return {
    label,
    runId,
    modelCalls: usage?.calls ?? 0,
    repairCalls: usage?.retries ?? 0,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
    wallClockMs: parsed.wallClockMs,
    verificationMs: report?.efficiency?.stateproof?.verificationWallMs ?? null,
    cacheHits: report?.efficiency?.stateproof?.cacheHits ?? null,
    svr: requirement?.safetyViolationRecall ?? null,
    fvr: requirement?.falseViolationRate ?? null,
    cdr: requirement?.completeDiagnosisRate ?? null,
    bva: report?.verdictMetrics?.balancedVerdictAccuracy ?? null,
    evidenceValidity: report?.evidenceRefValidity ?? null,
    partialRequirements: partialRequirements(contractRunId),
  };
}

function cell(value: number | null): string {
  return value === null ? '—' : String(value);
}

function render(columns: readonly Column[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const rows: string[] = [
    line(['Metric', ...columns.map((column) => column.label)]),
    line(['---', ...columns.map(() => '---')]),
  ];

  const row = (name: string, pick: (column: Column) => string): void => {
    rows.push(line([name, ...columns.map((column) => pick(column))]));
  };

  row('Run id', (column) => `\`${column.runId}\``);
  row('SVR', (column) => formatRate(column.svr));
  row('FVR', (column) => formatRate(column.fvr));
  row('CDR', (column) => formatRate(column.cdr));
  row('BVA', (column) => formatRate(column.bva));
  row('Evidence-ref validity', (column) => formatRate(column.evidenceValidity));
  row('Partial requirements', (column) => cell(column.partialRequirements));
  row('Model calls', (column) => cell(column.modelCalls));
  row('Repair calls', (column) => cell(column.repairCalls));
  row('Input tokens', (column) => cell(column.inputTokens));
  row('Output tokens', (column) => cell(column.outputTokens));
  row('Total tokens', (column) => cell(column.totalTokens));
  row('Wall clock (ms)', (column) => cell(column.wallClockMs));
  row('Deterministic verification (ms)', (column) => cell(column.verificationMs));
  row('Contract cache hits', (column) => cell(column.cacheHits));

  return rows.join('\n');
}

function reduction(before: number | null, after: number | null): string {
  if (before === null || after === null || before === 0) return 'n/a';
  return formatRate((before - after) / before);
}

function main(): void {
  const pairs = process.argv.slice(2).filter((argument) => argument.includes('='));
  if (pairs.length === 0) {
    process.stderr.write('usage: pnpm compare:development <label>=<runId> ...\n');
    process.exitCode = 2;
    return;
  }

  const columns = pairs.map((pair) => {
    const index = pair.indexOf('=');
    return columnFor(pair.slice(0, index), pair.slice(index + 1));
  });

  const table = render(columns);
  process.stdout.write(`${table}\n\n`);

  const baseline = columns[0];
  const guardrailsMet = (column: Column): boolean =>
    column.svr === 1 && column.cdr === 1 && column.fvr === 0 && column.bva === 1;

  const lines: string[] = [];
  for (const column of columns.slice(1)) {
    if (!guardrailsMet(column)) {
      lines.push(
        `- ${column.label}: no reduction claimed — quality guardrails not met ` +
          `(SVR ${formatRate(column.svr)}, FVR ${formatRate(column.fvr)}, ` +
          `CDR ${formatRate(column.cdr)}, BVA ${formatRate(column.bva)}).`,
      );
      continue;
    }
    lines.push(
      `- ${column.label} vs baseline: model calls ${reduction(baseline?.modelCalls ?? null, column.modelCalls)}, ` +
        `tokens ${reduction(baseline?.totalTokens ?? null, column.totalTokens)}, ` +
        `wall clock ${reduction(baseline?.wallClockMs ?? null, column.wallClockMs)}.`,
    );
  }

  // Break-even needs a cold column and a measured warm one that both qualify.
  const cold = columns.find((column) => column.label.includes('cold') && guardrailsMet(column));
  const warm = columns.find((column) => column.label.includes('warm') && guardrailsMet(column));
  if (
    cold !== undefined &&
    warm !== undefined &&
    baseline !== undefined &&
    baseline.totalTokens !== null &&
    cold.totalTokens !== null &&
    warm.totalTokens !== null &&
    baseline.totalTokens > warm.totalTokens
  ) {
    const runs = Math.max(
      1,
      Math.ceil((cold.totalTokens - warm.totalTokens) / (baseline.totalTokens - warm.totalTokens)),
    );
    lines.push(`- Break-even: ${runs} run(s) of the suite before compiling once is cheaper.`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);

  const outPath = path.join(ARTIFACTS, 'reports', 'development-comparison.md');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    ['# Development comparison', '', 'Generated from run artifacts.', '', table, '', ...lines, ''].join('\n'),
    'utf8',
  );
  process.stdout.write(`\nwritten: ${outPath}\n`);
}

main();
