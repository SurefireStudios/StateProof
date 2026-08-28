import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type JsonValue,
  type StateSnapshot,
  ToolRegistrySchema,
  replayTrajectory,
} from '@stateproof/core';
import { snapshot } from './fixtures/builders';
import type { CaseSpec } from './fixtures/cases';
import { buildHardCaseSpecs } from './fixtures/hard-cases';

/**
 * Regenerates every PhantomBench-Hard-12 fixture from `scripts/fixtures/`.
 *
 * Same construction as the Core-12 generator: `final-state.json` is produced by
 * replaying the trajectory, so each fixture is derivable from its own write
 * events. Core-12 is never touched by this script.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE_CASES_DIR = path.join(REPO_ROOT, 'benchmarks', 'phantombench-12', 'cases');
const HARD_ROOT = path.join(REPO_ROOT, 'benchmarks', 'phantombench-hard-12');
const HARD_CASES_DIR = path.join(HARD_ROOT, 'cases');
const HARD_SPLITS_DIR = path.join(HARD_ROOT, 'splits');

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath: string, rows: readonly unknown[]): void {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function baseRegistry() {
  const raw = readFileSync(path.join(CORE_CASES_DIR, 'PB-A03', 'tool-registry.json'), 'utf8');
  return ToolRegistrySchema.parse(JSON.parse(raw) as JsonValue);
}

function finalStateFor(spec: CaseSpec, initialState: StateSnapshot): StateSnapshot {
  const replay = replayTrajectory(initialState, spec.trajectory, spec.toolRegistry);
  if (replay.issues.length > 0) {
    const detail = replay.issues
      .map((issue) => `  - [${issue.kind}] seq ${issue.seq ?? '-'}: ${issue.message}`)
      .join('\n');
    throw new Error(`[${spec.caseId}] replay reported issues:\n${detail}`);
  }
  const lastEvent = spec.trajectory[spec.trajectory.length - 1];
  const capturedAt =
    spec.finalCapturedAt ??
    (lastEvent === undefined ? initialState.capturedAt : lastEvent.timestamp);
  return snapshot(spec.caseId, 'final', replay.collections, capturedAt);
}

function writeCase(spec: CaseSpec): void {
  const caseDir = path.join(HARD_CASES_DIR, spec.caseId);
  mkdirSync(caseDir, { recursive: true });

  const initialState = snapshot(spec.caseId, 'initial', spec.initialCollections, spec.task.issuedAt);
  const finalState = finalStateFor(spec, initialState);

  writeJson(path.join(caseDir, 'task.json'), spec.task);
  writeJson(path.join(caseDir, 'tool-registry.json'), spec.toolRegistry);
  writeJson(path.join(caseDir, 'initial-state.json'), initialState);
  writeJsonl(path.join(caseDir, 'trajectory.jsonl'), spec.trajectory);
  writeJson(path.join(caseDir, 'final-state.json'), finalState);
  writeFileSync(path.join(caseDir, 'final-response.txt'), `${spec.finalResponse}\n`, 'utf8');
  writeJson(path.join(caseDir, 'gold-contract.json'), spec.goldContract);
  writeJson(path.join(caseDir, 'gold-verdict.json'), spec.goldVerdict);
  writeJson(path.join(caseDir, 'case-metadata.json'), spec.metadata);

  const records = Object.values(spec.initialCollections).reduce(
    (total, list) => total + list.length,
    0,
  );
  process.stdout.write(
    `wrote ${spec.caseId}  split=${spec.metadata.split}  gold=${spec.goldVerdict.overall}  ` +
      `records=${records}  events=${spec.trajectory.length}  failed=${spec.metadata.failedRequirementIds.length}\n`,
  );
}

function writeSplits(specs: readonly CaseSpec[]): void {
  for (const split of ['development', 'locked'] as const) {
    const caseIds = specs
      .filter((spec) => spec.metadata.split === split)
      .map((spec) => spec.caseId)
      .sort();
    writeJson(path.join(HARD_SPLITS_DIR, `${split}.json`), {
      schemaVersion: '1.0.0',
      split,
      description:
        split === 'development'
          ? 'Adversarial multi-fault cases used for development measurement. 8 cases, 4 valid / 4 invalid.'
          : 'Adversarial challenge cases held back until the final system is frozen. 4 cases, 2 valid / 2 invalid.',
      caseIds,
    });
    process.stdout.write(`wrote splits/${split}.json (${caseIds.length} cases)\n`);
  }
}

function main(): void {
  const specs = buildHardCaseSpecs(baseRegistry());
  for (const spec of specs) writeCase(spec);
  writeSplits(specs);
  process.stdout.write(`\n${specs.length} hard case(s) generated.\n`);
}

main();
