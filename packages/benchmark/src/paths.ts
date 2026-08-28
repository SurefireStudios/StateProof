import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file so the CLI works from any cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const BENCHMARK_NAME = 'phantombench-12';

export const BENCHMARK_ROOT = path.join(REPO_ROOT, 'benchmarks', BENCHMARK_NAME);
export const CASES_DIR = path.join(BENCHMARK_ROOT, 'cases');
export const SPLITS_DIR = path.join(BENCHMARK_ROOT, 'splits');

export function caseDirFor(caseId: string, casesDir: string = CASES_DIR): string {
  return path.join(casesDir, caseId);
}

/** Case directories, sorted, so loading and hashing are deterministic. */
export function listCaseIds(casesDir: string = CASES_DIR): string[] {
  return readdirSync(casesDir)
    .filter((entry) => statSync(path.join(casesDir, entry)).isDirectory())
    .sort();
}
