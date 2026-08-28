import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file so the CLI works from any cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Two datasets live side by side and must never be conflated.
 *
 * `phantombench-12` is the Core-12 single-fault sanity/regression suite whose
 * v1 baseline result is frozen. `phantombench-hard-12` is the adversarial
 * multi-fault suite. Every loader takes an explicit directory, so a runner
 * points at one dataset and cannot silently read the other.
 */
export interface DatasetPaths {
  readonly name: string;
  readonly root: string;
  readonly casesDir: string;
  readonly splitsDir: string;
}

export function datasetPaths(name: string): DatasetPaths {
  const root = path.join(REPO_ROOT, 'benchmarks', name);
  return {
    name,
    root,
    casesDir: path.join(root, 'cases'),
    splitsDir: path.join(root, 'splits'),
  };
}

export const BENCHMARK_NAME = 'phantombench-12';
export const HARD_BENCHMARK_NAME = 'phantombench-hard-12';

export const CORE_DATASET = datasetPaths(BENCHMARK_NAME);
export const HARD_DATASET = datasetPaths(HARD_BENCHMARK_NAME);

export const BENCHMARK_ROOT = CORE_DATASET.root;
export const CASES_DIR = CORE_DATASET.casesDir;
export const SPLITS_DIR = CORE_DATASET.splitsDir;

export const HARD_CASES_DIR = HARD_DATASET.casesDir;
export const HARD_SPLITS_DIR = HARD_DATASET.splitsDir;

export function caseDirFor(caseId: string, casesDir: string = CASES_DIR): string {
  return path.join(casesDir, caseId);
}

/** Case directories, sorted, so loading and hashing are deterministic. */
export function listCaseIds(casesDir: string = CASES_DIR): string[] {
  return readdirSync(casesDir)
    .filter((entry) => statSync(path.join(casesDir, entry)).isDirectory())
    .sort();
}
