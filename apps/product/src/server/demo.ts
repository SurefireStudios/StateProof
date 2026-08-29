import { readFileSync } from 'node:fs';
import path from 'node:path';
import { diffSnapshots } from '@stateproof/core';
import { HARD_CASES_DIR, loadAgentVisibleCase } from '@stateproof/benchmark';
import { loadReproductionManifest } from '@stateproof/submission';
import type { DemoSummary, RunView } from '../shared/types';
import { buildRunView, readContractArtifact, storeRun } from './runs';

/**
 * The built-in demo: one committed development case, verified with the frozen
 * contract, entirely offline.
 *
 * `PBH-B03` is the default because it fails in three independent ways a person
 * can hold in their head at once — wrong amount, missing note, and an approval
 * that arrived *after* the money moved — and because the third is invisible in
 * both the agent's summary and the tool log. It is a development case, so
 * nothing here re-presents a locked result as a fresh evaluation.
 */

export const DEMO_CASE_ID = 'PBH-B03';
export const DEMO_WHY =
  'A development case with three independent faults: a refund executed for the wrong ' +
  'amount, a required support note that was never written, and a human approval recorded ' +
  'after the protected action rather than before it. The final response claims success.';

interface DemoContext {
  readonly caseId: string;
  readonly contractPath: string;
  readonly contractHash: string;
  readonly taskFingerprint: string;
  readonly promptPath: string;
  readonly promptHash: string;
  readonly assertionSchemaVersion: string;
}

/**
 * Resolves the frozen contract for the demo case through the pinned registry,
 * so the product cannot drift from the submitted artifacts.
 */
export function demoContext(repoRoot: string, caseId: string = DEMO_CASE_ID): DemoContext {
  const manifest = loadReproductionManifest(repoRoot);
  if (!manifest.replayCaseIds.includes(caseId)) {
    throw new Error(`${caseId} is not a development case in the pinned registry`);
  }

  const bundle = manifest.contractBundles[0];
  if (bundle === undefined) throw new Error('the pinned registry holds no contract bundle');

  // Which of the three frozen contracts this case used, read from the
  // submitted prediction file rather than recomputed.
  const target = manifest.runs.find((run) => run.id === manifest.replayTargetRunId);
  if (target === undefined) throw new Error('the pinned registry has no replay target');
  const predictions = JSON.parse(
    readFileSync(path.join(repoRoot, target.predictionPath), 'utf8'),
  ) as { predictions: Array<{ caseId: string; taskFingerprint: string; contractHash: string }> };
  const entry = predictions.predictions.find((row) => row.caseId === caseId);
  if (entry === undefined) throw new Error(`no submitted prediction for ${caseId}`);

  const contract = bundle.contracts.find(
    (candidate) => candidate.taskFingerprint === entry.taskFingerprint,
  );
  if (contract === undefined) throw new Error(`no frozen contract for ${caseId}`);

  const artifact = readContractArtifact(repoRoot, contract.path);
  return {
    caseId,
    contractPath: contract.path,
    contractHash: contract.contractHash,
    taskFingerprint: contract.taskFingerprint,
    promptPath: artifact.promptPath,
    promptHash: artifact.promptHash,
    assertionSchemaVersion: artifact.assertionSchemaVersion,
  };
}

/** What the demo page shows *before* the user asks for verification. */
export function demoSummary(repoRoot: string, caseId: string = DEMO_CASE_ID): DemoSummary {
  const context = demoContext(repoRoot, caseId);
  const agentVisible = loadAgentVisibleCase(caseId, { casesDir: HARD_CASES_DIR });
  const artifact = readContractArtifact(repoRoot, context.contractPath);
  const changes = diffSnapshots(agentVisible.initialState, agentVisible.finalState);

  return {
    caseId,
    label: `Refund operations — ${caseId}`,
    task: agentVisible.task.instruction,
    agentClaim: agentVisible.finalResponse,
    toolCallCount: agentVisible.trajectory.filter((event) => event.type === 'tool_call').length,
    eventCount: agentVisible.trajectory.length,
    collectionCount: Object.keys(agentVisible.finalState.collections).length,
    changedRecordCount: changes.length,
    contractHash: context.contractHash,
    requirementCount: artifact.contract.requirements.length,
    whyThisCase: DEMO_WHY,
  };
}

/** Runs the frozen verifier. No model is contacted, here or anywhere below. */
export function verifyDemo(repoRoot: string, caseId: string = DEMO_CASE_ID): RunView {
  const context = demoContext(repoRoot, caseId);
  const artifact = readContractArtifact(repoRoot, context.contractPath);
  const agentVisible = loadAgentVisibleCase(caseId, { casesDir: HARD_CASES_DIR });

  return storeRun(
    buildRunView({
      label: `Demo — ${caseId}`,
      caseId,
      agentVisible,
      contract: artifact.contract,
      contractHash: context.contractHash,
      taskFingerprint: context.taskFingerprint,
      promptPath: context.promptPath,
      promptHash: context.promptHash,
      assertionSchemaVersion: context.assertionSchemaVersion,
      contractSource: 'frozen-bundle',
      imported: false,
    }),
  );
}
