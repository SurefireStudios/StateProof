import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type JsonValue,
  type StateSnapshot,
  ToolRegistrySchema,
  replayTrajectory,
} from '@stateproof/core';
import { type CaseSpec, buildCaseSpecs } from './fixtures/cases';
import { snapshot } from './fixtures/builders';

/**
 * Regenerates every PhantomBench fixture file from `scripts/fixtures/`.
 * PB-A03 keeps its original hand-authored timestamps and agent-visible content.
 *
 * `final-state.json` is produced by replaying the trajectory against
 * `initial-state.json`, so every fixture is derivable from its own write
 * events by construction. `pnpm benchmark:validate` re-derives it
 * independently, which is what catches later hand-edits.
 *
 * Everything gold - contract, verdict, metadata - is hand-authored in
 * scripts/fixtures/cases.ts and never inferred from the replay.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CASES_DIR = path.join(REPO_ROOT, 'benchmarks', 'phantombench-12', 'cases');
const SPLITS_DIR = path.join(REPO_ROOT, 'benchmarks', 'phantombench-12', 'splits');

/**
 * PB-A03's tool registry is the canonical Template A registry; it is read from
 * disk rather than re-declared so every Template A case shares one definition.
 */
const REGISTRY_SOURCE_CASE_ID = 'PB-A03';

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath: string, rows: readonly unknown[]): void {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function frozenRegistry() {
  const raw = readFileSync(
    path.join(CASES_DIR, REGISTRY_SOURCE_CASE_ID, 'tool-registry.json'),
    'utf8',
  );
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
  const caseDir = path.join(CASES_DIR, spec.caseId);
  mkdirSync(caseDir, { recursive: true });

  const initialState = snapshot(
    spec.caseId,
    'initial',
    spec.initialCollections,
    spec.task.issuedAt,
  );
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

  process.stdout.write(
    `wrote ${spec.caseId}  split=${spec.metadata.split}  gold=${spec.goldVerdict.overall}\n`,
  );
}

function writeSplits(specs: readonly CaseSpec[]): void {
  const development = specs
    .filter((s) => s.metadata.split === 'development')
    .map((s) => s.caseId)
    .sort();
  const locked = specs.filter((s) => s.metadata.split === 'locked').map((s) => s.caseId).sort();

  writeJson(path.join(SPLITS_DIR, 'development.json'), {
    schemaVersion: '1.0.0',
    split: 'development',
    description:
      'Cases used while building and tuning StateProof. Target size 8 (4 gold PASS / 4 gold FAIL) per the approved case matrix.',
    caseIds: development,
  });
  writeJson(path.join(SPLITS_DIR, 'locked.json'), {
    schemaVersion: '1.0.0',
    split: 'locked',
    description:
      'Challenge cases held back from all prompt tuning until the final locked comparison. Target size 4 (2 gold PASS / 2 gold FAIL). Never included in intermediate metric runs.',
    caseIds: locked,
  });
  process.stdout.write(
    `wrote splits: ${development.length} development, ${locked.length} locked\n`,
  );
}

function main(): void {
  const specs = buildCaseSpecs(frozenRegistry());
  for (const spec of specs) writeCase(spec);
  writeSplits(specs);
  process.stdout.write(`\n${specs.length} case(s) generated.\n`);
}

main();
