import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type AgentVisibleCase,
  type RecordChange,
  type TraceEvent,
  diffSnapshots,
} from '@stateproof/core';
import { HARD_CASES_DIR, loadAgentVisibleCase } from '@stateproof/benchmark';
import {
  type LoadedRun,
  type MetricView,
  type SubmissionView,
  type UsageView,
  combineMetrics,
  combineUsage,
  loadSubmissionView,
  meetsFinalGuardrails,
  metricViewOfRun,
  usageOf,
} from '@stateproof/submission';

/**
 * Assembles everything the pages render, once, from artifacts.
 *
 * Two sources and no third: the pinned submission registry (runs, reports,
 * contracts) and the *agent-visible* half of each benchmark case (task, tools,
 * trajectory, both states, final response). Gold contracts and gold verdicts
 * are never loaded here — where a page shows gold-versus-prediction, it reads
 * the completed report artifact, which is the only place gold is allowed to
 * appear.
 */

export interface RequirementView {
  readonly requirementKey: string;
  readonly status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  readonly reason: string;
  readonly description: string;
  readonly evidenceRefs: string[];
}

export interface CaseView {
  readonly caseId: string;
  readonly task: string;
  readonly finalResponse: string;
  readonly verdict: string;
  readonly requirements: RequirementView[];
  readonly trajectory: readonly TraceEvent[];
  readonly diff: RecordChange[];
  readonly agentVisible: AgentVisibleCase;
  readonly contract: {
    readonly taskFingerprint: string;
    readonly contractHash: string;
    readonly promptPath: string;
    readonly promptHash: string;
    readonly assertionSchemaVersion: string;
    readonly coldCacheHit: boolean;
    readonly warmCacheHit: boolean;
  };
  readonly baseline: {
    readonly verdict: string;
    readonly goldVerdict: string;
    readonly correct: boolean;
    readonly goldFailedKeys: string[];
    readonly predictedFailedKeys: string[];
    readonly missedKeys: string[];
    readonly falselyFailedKeys: string[];
  } | null;
  readonly stateproofScored: {
    readonly goldVerdict: string;
    readonly correct: boolean;
    readonly goldFailedKeys: string[];
    readonly predictedFailedKeys: string[];
    readonly missedKeys: string[];
    readonly falselyFailedKeys: string[];
    readonly completelyDiagnosed: boolean;
  } | null;
}

/** The final three-view result, present only once the locked run exists. */
export interface FinalViews {
  readonly baselineDevelopment: MetricView;
  readonly stateproofDevelopment: MetricView;
  readonly baselineLocked: MetricView;
  readonly stateproofLocked: MetricView;
  readonly baselineCombined: MetricView;
  readonly stateproofCombined: MetricView;
  readonly baselineCombinedUsage: UsageView;
  readonly firstDeployment: UsageView;
  readonly repeatedVerification: UsageView;
  readonly guardrailsMet: boolean;
  readonly callReduction: number | null;
  readonly tokenReduction: number | null;
  readonly repeatedTokenReduction: number | null;
  readonly breakEvenRuns: number | null;
}

export interface DashboardModel {
  readonly view: SubmissionView;
  readonly baseline: LoadedRun;
  readonly coreBaseline: LoadedRun | null;
  readonly v1: LoadedRun;
  readonly v2: LoadedRun;
  readonly cold: LoadedRun;
  readonly warm: LoadedRun;
  readonly warmRepeats: LoadedRun[];
  readonly lockedBaseline: LoadedRun | null;
  readonly lockedStateProof: LoadedRun | null;
  readonly final: FinalViews | null;
  readonly comparisonRuns: LoadedRun[];
  readonly cases: CaseView[];
  readonly lockedCaseIds: string[];
  readonly defaultCaseId: string;
  readonly reductions: {
    readonly coldCalls: number | null;
    readonly coldTokens: number | null;
    readonly coldWallClock: number | null;
    readonly warmCalls: number | null;
    readonly warmTokens: number | null;
    readonly warmWallClock: number | null;
    readonly breakEvenRuns: number | null;
    readonly eligible: boolean;
  };
}

interface PredictionEntry {
  readonly caseId: string;
  readonly taskFingerprint: string;
  readonly contractHash: string;
  readonly cacheHit: boolean;
  readonly prediction: {
    readonly verdict: string;
    readonly requirementAssessments: Array<{
      requirementKey: string;
      status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
      reason: string;
      evidenceRefs: string[];
    }>;
  };
}

function predictionsOf(run: LoadedRun): PredictionEntry[] {
  return (run.predictionFile as { predictions: PredictionEntry[] }).predictions;
}

function requireRun(view: SubmissionView, role: LoadedRun['registered']['role']): LoadedRun {
  const run = view.byRole.get(role)?.[0];
  if (run === undefined) throw new Error(`the registry pins no run for role "${role}"`);
  return run;
}

function ratio(before: number, after: number): number | null {
  return before === 0 ? null : (before - after) / before;
}

/** The default inspector case: three independent faults in one run. */
export const DEFAULT_CASE_ID = 'PBH-B03';

export function buildModel(repoRoot: string): DashboardModel {
  const view = loadSubmissionView({ repoRoot });

  const baseline = requireRun(view, 'baseline-hard');
  const v1 = requireRun(view, 'stateproof-v1-cold');
  const v2 = requireRun(view, 'stateproof-v2-cold');
  const cold = requireRun(view, 'stateproof-v3-cold');
  const warm = requireRun(view, 'stateproof-v3-warm');
  const warmRepeats = view.byRole.get('stateproof-v3-warm-repeat') ?? [];
  const coreBaseline = view.byRole.get('baseline-core')?.[0] ?? null;
  const lockedBaseline = view.byRole.get('baseline-hard-locked')?.[0] ?? null;
  const lockedStateProof = view.byRole.get('stateproof-v3-locked')?.[0] ?? null;

  const bundle = view.bundles[0];
  if (bundle === undefined) throw new Error('the registry pins no contract bundle');
  const bundleManifest = JSON.parse(
    readFileSync(path.join(repoRoot, bundle.registered.manifestPath), 'utf8'),
  ) as { promptPath: string; promptHash: string; assertionSchemaVersion: string };

  // Locked predictions come from the locked run; development from the cold run.
  const coldById = new Map([
    ...predictionsOf(cold).map((entry) => [entry.caseId, entry] as const),
    ...(lockedStateProof === null
      ? []
      : predictionsOf(lockedStateProof).map((entry) => [entry.caseId, entry] as const)),
  ]);
  const warmById = new Map([
    ...predictionsOf(warm).map((entry) => [entry.caseId, entry] as const),
    ...(lockedStateProof === null
      ? []
      : predictionsOf(lockedStateProof).map((entry) => [entry.caseId, entry] as const)),
  ]);
  const baselineRows = new Map([
    ...(baseline.report.caseResults ?? []).map((row) => [row.caseId, row] as const),
    ...(lockedBaseline?.report.caseResults ?? []).map((row) => [row.caseId, row] as const),
  ]);
  const coldRows = new Map([
    ...(cold.report.caseResults ?? []).map((row) => [row.caseId, row] as const),
    ...(lockedStateProof?.report.caseResults ?? []).map((row) => [row.caseId, row] as const),
  ]);

  // Requirement descriptions live in the compiled contract, keyed by fingerprint.
  const descriptionByFingerprint = new Map<string, Map<string, string>>();
  for (const contract of bundle.contracts) {
    const requirements = (
      contract.artifact['contract'] as {
        requirements: Array<{ requirementKey: string; description: string }>;
      }
    ).requirements;
    descriptionByFingerprint.set(
      contract.taskFingerprint,
      new Map(requirements.map((requirement) => [requirement.requirementKey, requirement.description])),
    );
  }

  const lockedCaseIds = view.manifest.lockedReplayCaseIds ?? [];
  const cases: CaseView[] = [...view.manifest.replayCaseIds, ...lockedCaseIds].map((caseId) => {
    const entry = coldById.get(caseId);
    if (entry === undefined) throw new Error(`the pinned cold run has no prediction for ${caseId}`);
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir: HARD_CASES_DIR });
    const descriptions = descriptionByFingerprint.get(entry.taskFingerprint) ?? new Map();
    const baselineRow = baselineRows.get(caseId);
    const coldRow = coldRows.get(caseId);

    return {
      caseId,
      task: agentVisible.task.instruction,
      finalResponse: agentVisible.finalResponse,
      verdict: entry.prediction.verdict,
      requirements: entry.prediction.requirementAssessments.map((assessment) => ({
        requirementKey: assessment.requirementKey,
        status: assessment.status,
        reason: assessment.reason,
        description: descriptions.get(assessment.requirementKey) ?? '',
        evidenceRefs: assessment.evidenceRefs,
      })),
      trajectory: agentVisible.trajectory,
      diff: diffSnapshots(agentVisible.initialState, agentVisible.finalState),
      agentVisible,
      contract: {
        taskFingerprint: entry.taskFingerprint,
        contractHash: entry.contractHash,
        promptPath: bundleManifest.promptPath,
        promptHash: bundleManifest.promptHash,
        assertionSchemaVersion: bundleManifest.assertionSchemaVersion,
        coldCacheHit: entry.cacheHit,
        warmCacheHit: warmById.get(caseId)?.cacheHit ?? false,
      },
      baseline:
        baselineRow === undefined
          ? null
          : {
              verdict: baselineRow.predictedVerdict,
              goldVerdict: baselineRow.goldVerdict,
              correct: baselineRow.correct,
              goldFailedKeys: baselineRow.goldFailedKeys ?? [],
              predictedFailedKeys: baselineRow.predictedFailedKeys ?? [],
              missedKeys: baselineRow.missedKeys ?? [],
              falselyFailedKeys: baselineRow.falselyFailedKeys ?? [],
            },
      stateproofScored:
        coldRow === undefined
          ? null
          : {
              goldVerdict: coldRow.goldVerdict,
              correct: coldRow.correct,
              goldFailedKeys: coldRow.goldFailedKeys ?? [],
              predictedFailedKeys: coldRow.predictedFailedKeys ?? [],
              missedKeys: coldRow.missedKeys ?? [],
              falselyFailedKeys: coldRow.falselyFailedKeys ?? [],
              completelyDiagnosed: coldRow.completelyDiagnosed ?? false,
            },
    };
  });

  const eligible = cold.guardrailsMet && warm.guardrailsMet;
  const reductions = {
    eligible,
    coldCalls: eligible ? ratio(baseline.modelCalls, cold.modelCalls) : null,
    coldTokens: eligible ? ratio(baseline.totalTokens, cold.totalTokens) : null,
    coldWallClock: eligible ? ratio(baseline.wallClockMs, cold.wallClockMs) : null,
    warmCalls: eligible ? ratio(baseline.modelCalls, warm.modelCalls) : null,
    warmTokens: eligible ? ratio(baseline.totalTokens, warm.totalTokens) : null,
    warmWallClock: eligible ? ratio(baseline.wallClockMs, warm.wallClockMs) : null,
    breakEvenRuns:
      eligible && baseline.totalTokens > warm.totalTokens
        ? Math.max(
            1,
            Math.ceil(
              (cold.totalTokens - warm.totalTokens) / (baseline.totalTokens - warm.totalTokens),
            ),
          )
        : null,
  };

  const ratioOf = (before: number, after: number): number | null =>
    before === 0 ? null : (before - after) / before;

  // The final three-view result exists only when the locked evaluation does.
  let final: FinalViews | null = null;
  if (lockedBaseline !== null && lockedStateProof !== null) {
    const baselineDevelopment = metricViewOfRun(baseline);
    const stateproofDevelopment = metricViewOfRun(cold);
    const baselineLocked = metricViewOfRun(lockedBaseline);
    const stateproofLocked = metricViewOfRun(lockedStateProof);
    const baselineCombined = combineMetrics(baselineDevelopment, baselineLocked);
    const stateproofCombined = combineMetrics(stateproofDevelopment, stateproofLocked);
    const baselineCombinedUsage = combineUsage(usageOf(baseline), usageOf(lockedBaseline));
    // First deployment pays for the three contracts once and covers all twelve
    // cases: the locked tasks resolve to the same three fingerprints.
    const firstDeployment: UsageView = {
      ...usageOf(cold),
      deterministicVerificationMs:
        (cold.verificationWallMs ?? 0) + (lockedStateProof.verificationWallMs ?? 0),
    };
    const repeatedVerification = combineUsage(usageOf(warm), usageOf(lockedStateProof));
    const guardrails =
      meetsFinalGuardrails(stateproofLocked) && meetsFinalGuardrails(stateproofCombined);

    final = {
      baselineDevelopment,
      stateproofDevelopment,
      baselineLocked,
      stateproofLocked,
      baselineCombined,
      stateproofCombined,
      baselineCombinedUsage,
      firstDeployment,
      repeatedVerification,
      guardrailsMet: guardrails,
      callReduction: guardrails
        ? ratioOf(baselineCombinedUsage.modelCalls, firstDeployment.modelCalls)
        : null,
      tokenReduction: guardrails
        ? ratioOf(baselineCombinedUsage.totalTokens, firstDeployment.totalTokens)
        : null,
      repeatedTokenReduction: guardrails
        ? ratioOf(baselineCombinedUsage.totalTokens, repeatedVerification.totalTokens)
        : null,
      breakEvenRuns:
        guardrails && baselineCombinedUsage.totalTokens > repeatedVerification.totalTokens
          ? Math.max(
              1,
              Math.ceil(
                (firstDeployment.totalTokens - repeatedVerification.totalTokens) /
                  (baselineCombinedUsage.totalTokens - repeatedVerification.totalTokens),
              ),
            )
          : null,
    };
  }

  return {
    view,
    baseline,
    coreBaseline,
    v1,
    v2,
    cold,
    warm,
    warmRepeats,
    lockedBaseline,
    lockedStateProof,
    final,
    comparisonRuns: [baseline, v1, v2, cold, warm],
    cases,
    lockedCaseIds,
    defaultCaseId: cases.some((entry) => entry.caseId === DEFAULT_CASE_ID)
      ? DEFAULT_CASE_ID
      : (cases[0]?.caseId ?? DEFAULT_CASE_ID),
    reductions,
  };
}

/**
 * Turns an evidence reference into the DOM ids it could point at.
 *
 * References are generated by the verifier in three shapes — `event:EV-004`,
 * `state:final.emails.MSG-7204`, `state_diff:orders` — and each one names
 * something rendered on the page.
 */
export function evidenceTargets(ref: string): string[] {
  if (ref.startsWith('event:')) return [`ev-${ref.slice('event:'.length)}`];
  if (ref.startsWith('state_diff:')) return [`diff-${ref.slice('state_diff:'.length)}`];
  if (ref.startsWith('state:')) {
    const parts = ref.slice('state:'.length).split('.');
    const [state, collection, recordId] = parts;
    if (state !== undefined && collection !== undefined && recordId !== undefined) {
      return [`rec-${state}-${collection}-${recordId}`, `diff-${collection}`];
    }
    if (state !== undefined && collection !== undefined) return [`diff-${collection}`];
  }
  if (ref === 'trajectory') return ['timeline'];
  return [];
}
