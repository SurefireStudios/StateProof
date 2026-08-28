import {
  type BenchmarkCase,
  type CaseMetadata,
  CaseMetadataSchema,
  type GoldVerdict,
  GoldVerdictSchema,
  type TaskContract,
  TaskContractSchema,
  combineHashes,
  hashJson,
  sha256Hex,
  toJsonValue,
} from '@stateproof/core';
import { type CaseFileReader, createGoldReader } from './fs-guard';
import { hashAgentVisibleCase, loadAgentVisibleCase, parseOrThrow } from './load-agent-input';
import { CASES_DIR, caseDirFor, listCaseIds } from './paths';

export { caseIdsForSplit, loadSplitManifest } from './splits';

/**
 * Human-only loaders. Used by fixture validation and by the scoring layer,
 * never by anything that builds a model prompt.
 */

export interface GoldBundle {
  readonly goldContract: TaskContract;
  readonly goldVerdict: GoldVerdict;
  readonly metadata: CaseMetadata;
}

export interface GoldLoadOptions {
  readonly casesDir?: string;
  readonly reader?: CaseFileReader;
}

export function loadGoldBundle(caseId: string, options: GoldLoadOptions = {}): GoldBundle {
  const reader =
    options.reader ?? createGoldReader(caseDirFor(caseId, options.casesDir ?? CASES_DIR));
  return {
    goldContract: parseOrThrow(
      TaskContractSchema,
      reader.readJson('gold-contract.json'),
      caseId,
      'gold-contract.json',
    ),
    goldVerdict: parseOrThrow(
      GoldVerdictSchema,
      reader.readJson('gold-verdict.json'),
      caseId,
      'gold-verdict.json',
    ),
    metadata: parseOrThrow(
      CaseMetadataSchema,
      reader.readJson('case-metadata.json'),
      caseId,
      'case-metadata.json',
    ),
  };
}

export function loadBenchmarkCase(caseId: string, casesDir: string = CASES_DIR): BenchmarkCase {
  const gold = loadGoldBundle(caseId, { casesDir });
  return {
    caseId,
    agentVisible: loadAgentVisibleCase(caseId, { casesDir }),
    goldContract: gold.goldContract,
    goldVerdict: gold.goldVerdict,
    metadata: gold.metadata,
  };
}

export function loadAllCases(casesDir: string = CASES_DIR): BenchmarkCase[] {
  return listCaseIds(casesDir).map((caseId) => loadBenchmarkCase(caseId, casesDir));
}

/**
 * Dataset hash over every case's agent-visible content plus its gold data, so
 * a run manifest can prove which dataset produced a metric.
 */
export function datasetHash(cases: readonly BenchmarkCase[]): string {
  const parts: Array<readonly [string, string]> = cases.map((benchmarkCase) => [
    benchmarkCase.caseId,
    sha256Hex(
      [
        hashAgentVisibleCase(benchmarkCase.agentVisible),
        hashJson(toJsonValue(benchmarkCase.goldContract)),
        hashJson(toJsonValue(benchmarkCase.goldVerdict)),
        hashJson(toJsonValue(benchmarkCase.metadata)),
      ].join('|'),
    ),
  ]);
  return combineHashes(parts);
}
