import { describe, expect, it } from 'vitest';
import * as agentFacing from '@stateproof/benchmark';
import * as gold from '@stateproof/benchmark/gold';
import * as validate from '@stateproof/benchmark/validate';

/**
 * Gold isolation is claimed as a module-graph property, so it has to be one.
 * These names must be unreachable from the entry point that agent-facing code
 * imports.
 */
const GOLD_ONLY_EXPORTS = [
  'createGoldReader',
  'loadGoldBundle',
  'loadBenchmarkCase',
  'loadAllCases',
  'datasetHash',
] as const;

describe('@stateproof/benchmark package boundary', () => {
  const rootExports = Object.keys(agentFacing);

  it.each(GOLD_ONLY_EXPORTS)('does not export %s from the package root', (name) => {
    expect(rootExports).not.toContain(name);
    expect((agentFacing as Record<string, unknown>)[name]).toBeUndefined();
  });

  it('exports the agent-facing loaders the runner needs', () => {
    for (const name of [
      'loadAgentVisibleCase',
      'hashAgentVisibleCase',
      'caseIdsForSplit',
      'createAgentInputReader',
      'CASES_DIR',
    ]) {
      expect(rootExports).toContain(name);
    }
  });

  it('keeps the validator off the agent-facing root as well', () => {
    for (const name of ['validateBenchmark', 'validateCase', 'APPROVED_CASES']) {
      expect(rootExports).not.toContain(name);
    }
  });

  it('reaches gold only through the explicit /gold surface', () => {
    for (const name of GOLD_ONLY_EXPORTS) {
      expect(Object.keys(gold)).toContain(name);
    }
  });

  it('reaches the validator only through the explicit /validate surface', () => {
    for (const name of ['validateBenchmark', 'validateCase', 'validateContractConsistency']) {
      expect(Object.keys(validate)).toContain(name);
    }
  });
});
