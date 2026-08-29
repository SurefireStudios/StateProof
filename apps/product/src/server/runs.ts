import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type AgentVisibleCase,
  type CompiledContractV2,
  type RecordChange,
  type TraceEvent,
  assertionEvidenceRefs,
  diffSnapshots,
  normalizeRequirements,
} from '@stateproof/core';
import { evaluationContextFor, executeContract } from '@stateproof/agents';
import type {
  CollectionDiffSchema,
  ContractViewSchema,
  RequirementView,
  RunView,
} from '../shared/types';
import type { z } from 'zod';

/**
 * Building a run view, and keeping it in memory only.
 *
 * Verification here is the *same* `executeContract` the evaluation used — no
 * reimplementation, no cached verdict, no hardcoded answer. The product runs
 * the engine and shows what it returns.
 *
 * Nothing an importer uploads is written to disk, and every stored run expires:
 * this is a demonstration surface, not a datastore.
 */

export type ContractSource = z.infer<typeof ContractViewSchema>['source'];

export interface StoredRun {
  readonly view: RunView;
  readonly expiresAtMs: number;
}

const RUN_TTL_MS = 60 * 60 * 1000;
const MAX_RUNS = 200;
const runs = new Map<string, StoredRun>();

function sweep(nowMs: number): void {
  for (const [runId, stored] of runs) {
    if (stored.expiresAtMs <= nowMs) runs.delete(runId);
  }
  while (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
}

export function storeRun(view: RunView, nowMs = Date.now()): RunView {
  sweep(nowMs);
  runs.set(view.runId, { view, expiresAtMs: nowMs + RUN_TTL_MS });
  return view;
}

export function getRun(runId: string, nowMs = Date.now()): RunView | null {
  sweep(nowMs);
  return runs.get(runId)?.view ?? null;
}

export function clearRuns(): void {
  runs.clear();
}

/** DOM anchors an evidence reference could point at, mirroring the client ids. */
export function evidenceTargets(ref: string): string[] {
  if (ref.startsWith('event:')) return [`ev-${ref.slice('event:'.length)}`];
  if (ref.startsWith('state_diff:')) return [`diff-${ref.slice('state_diff:'.length)}`];
  if (ref.startsWith('state:')) {
    const [state, collection, recordId] = ref.slice('state:'.length).split('.');
    if (state !== undefined && collection !== undefined && recordId !== undefined) {
      return [`rec-${collection}-${recordId}`, `diff-${collection}`];
    }
    if (collection !== undefined) return [`diff-${collection}`];
  }
  if (ref === 'trajectory') return ['timeline'];
  return [];
}

function eventSummary(event: TraceEvent): string {
  switch (event.type) {
    case 'tool_call':
      return `${event.toolName}(${JSON.stringify(event.arguments)})`;
    case 'tool_result':
      return `${event.toolName} → ${event.status}${
        event.status === 'error' ? `: ${JSON.stringify(event.result)}` : ''
      }`;
    case 'human_approval':
      return `scope=${event.scope} decision=${event.decision} approver=${event.approver}`;
    case 'agent_message':
      return `${event.role}: ${event.content}`;
  }
}

function eventKind(event: TraceEvent): 'approval' | 'write' | 'error' | 'message' | 'result' {
  if (event.type === 'human_approval') return 'approval';
  if (event.type === 'tool_result') return event.status === 'error' ? 'error' : 'result';
  if (event.type === 'tool_call') return 'write';
  return 'message';
}

function renderValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function diffView(
  agentVisible: AgentVisibleCase,
  changes: readonly RecordChange[],
  citedRecordIds: ReadonlySet<string>,
  citedCollections: ReadonlySet<string>,
): Array<z.infer<typeof CollectionDiffSchema>> {
  const byCollection = new Map<string, RecordChange[]>();
  for (const collection of Object.keys(agentVisible.finalState.collections).sort()) {
    byCollection.set(collection, []);
  }
  for (const change of changes) {
    byCollection.set(change.collection, [...(byCollection.get(change.collection) ?? []), change]);
  }

  return [...byCollection.entries()].map(([collection, collectionChanges]) => ({
    collection,
    cited: citedCollections.has(collection),
    changes: collectionChanges.map((change) => ({
      recordId: change.recordId,
      kind: change.kind,
      cited: citedRecordIds.has(change.recordId),
      changedFields: change.changedFields.map((field) => ({
        field,
        before: renderValue(change.before?.[field]),
        after: renderValue(change.after?.[field]),
      })),
    })),
  }));
}

export interface BuildRunOptions {
  readonly label: string;
  readonly caseId: string | null;
  readonly agentVisible: AgentVisibleCase;
  readonly contract: CompiledContractV2;
  readonly contractHash: string;
  readonly taskFingerprint: string;
  readonly promptPath: string;
  readonly promptHash: string;
  readonly assertionSchemaVersion: string;
  readonly contractSource: ContractSource;
  readonly imported: boolean;
  /** Tokens spent compiling this contract in this session, if any. */
  readonly compilationModelCalls?: number;
  readonly compilationModelTokens?: number;
}

/**
 * Runs the frozen verifier and shapes the result for display.
 *
 * The verdict, every requirement status and every evidence reference come out
 * of `executeContract`. Nothing here decides an outcome.
 */
export function buildRunView(options: BuildRunOptions): RunView {
  const prediction = executeContract({
    contract: options.contract,
    contractHash: options.contractHash,
    agentVisible: options.agentVisible,
  });

  const context = evaluationContextFor(options.agentVisible);
  const normalized = normalizeRequirements(options.contract);
  const byKey = new Map(normalized.map((requirement) => [requirement.requirementKey, requirement]));

  const citedEventIds = new Set<string>();
  const citedRecordIds = new Set<string>();
  const citedCollections = new Set<string>();

  const requirements: RequirementView[] = prediction.requirementAssessments.map((assessment) => {
    const compiled = byKey.get(assessment.requirementKey);
    for (const ref of assessment.evidenceRefs) {
      if (ref.startsWith('event:')) citedEventIds.add(ref.slice('event:'.length));
      if (ref.startsWith('state_diff:')) citedCollections.add(ref.slice('state_diff:'.length));
      if (ref.startsWith('state:')) {
        const [, collection, recordId] = ref.slice('state:'.length).split('.');
        if (collection !== undefined) citedCollections.add(collection);
        if (recordId !== undefined) citedRecordIds.add(recordId);
      }
    }
    return {
      requirementKey: assessment.requirementKey,
      description: compiled?.description ?? '',
      category: compiled?.category ?? 'outcome',
      status: assessment.status,
      reason: assessment.reason,
      verificationCoverage: compiled?.verificationCoverage ?? 'complete',
      limitations: [...(compiled?.limitations ?? [])],
      evidence: assessment.evidenceRefs.map((ref) => ({ ref, targets: evidenceTargets(ref) })),
    };
  });

  // Referenced for completeness: the same builder the verifier used.
  void assertionEvidenceRefs;

  const timeline = options.agentVisible.trajectory.map((event) => ({
    eventId: event.eventId,
    seq: event.seq,
    type: event.type,
    summary: eventSummary(event),
    kind: eventKind(event),
    cited: citedEventIds.has(event.eventId),
  }));

  const changes = diffSnapshots(options.agentVisible.initialState, options.agentVisible.finalState);

  const view: RunView = {
    runId: `run_${randomUUID()}`,
    label: options.label,
    caseId: options.caseId,
    verifiedAt: new Date().toISOString(),
    mode:
      (options.compilationModelCalls ?? 0) > 0 ? 'model-assisted-compilation' : 'deterministic',
    verificationDurationMs: prediction.verificationDurationMs,
    modelCalls: options.compilationModelCalls ?? 0,
    modelTokens: options.compilationModelTokens ?? 0,
    verdict: prediction.verdict,
    task: options.agentVisible.task.instruction,
    agentClaim: options.agentVisible.finalResponse,
    requirements,
    timeline,
    diff: diffView(options.agentVisible, changes, citedRecordIds, citedCollections),
    contract: {
      taskSummary: options.contract.taskSummary,
      contractHash: options.contractHash,
      taskFingerprint: options.taskFingerprint,
      promptPath: options.promptPath,
      promptHash: options.promptHash,
      assertionSchemaVersion: options.assertionSchemaVersion,
      contractVersion: options.contract.contractVersion,
      source: options.contractSource,
      requirementCount: options.contract.requirements.length,
      ambiguities: [...options.contract.ambiguities],
    },
    imported: options.imported,
  };

  void context;
  return view;
}

/** Reads a committed contract artifact without touching gold data. */
export function readContractArtifact(
  repoRoot: string,
  relativePath: string,
): {
  contract: CompiledContractV2;
  contractHash: string;
  taskFingerprint: string;
  promptPath: string;
  promptHash: string;
  assertionSchemaVersion: string;
} {
  const artifact = JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as {
    contract: CompiledContractV2;
    contractHash: string;
    taskFingerprint: string;
    promptPath: string;
    promptHash: string;
    assertionSchemaVersion: string;
  };
  return artifact;
}
