import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EvaluationRunManifestSchema } from '@stateproof/core';
import {
  HARD_CASES_DIR,
  HUMAN_ONLY_FILES,
  caseIdsForSplit,
  HARD_SPLITS_DIR,
  loadAgentVisibleCase,
  onCaseFileRead,
} from '@stateproof/benchmark';
import { FakeModelClient, requestStructured } from '@stateproof/model-provider';
import {
  HARD_PROMPT_PATH,
  HardBaselinePredictionSchema,
  loadBaselinePrompt,
  renderBaselineUserMessage,
  runHardBaselinePredictions,
  scoreHardPredictions,
} from '@stateproof/agents';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempArtifacts(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stateproof-hard-'));
  tempRoots.push(root);
  return root;
}

const ALL_KEYS = [
  'refund_outcome',
  'customer_message_outcome',
  'approval_before_refund',
  'scope_integrity',
  'support_note_outcome',
  'no_new_refund',
] as const;

function assessment(key: string, status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW') {
  return { requirementKey: key, status, reason: 'scripted for testing', evidenceRefs: ['event:EV-001'] };
}

/** A response that assesses every key, so it is valid for any hard case. */
function fullResponse(status: 'PASS' | 'FAIL'): string {
  return JSON.stringify({
    verdict: status,
    confidence: 0.8,
    summary: 'Scripted assessment for testing.',
    requirementAssessments: ALL_KEYS.map((key) => assessment(key, status)),
    unresolved: [],
  });
}

const prompt = loadBaselinePrompt(HARD_PROMPT_PATH);

describe('baseline v2 prompt', () => {
  const agentVisible = loadAgentVisibleCase('PBH-A03', { casesDir: HARD_CASES_DIR });
  const userMessage = renderBaselineUserMessage(prompt, agentVisible);

  it('is frozen and hashed separately from v1', () => {
    expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
    const v1 = loadBaselinePrompt();
    expect(prompt.hash).not.toBe(v1.hash);
  });

  it('asks for requirement-level assessments', () => {
    expect(prompt.system).toContain('requirementAssessments');
    expect(prompt.system).toContain('Return each imposed key exactly once');
  });

  it.each([
    'PBH-A03',
    'A-OUT-01',
    'A-PROC-01',
    'goldLabel',
    'multiFault',
    'failedRequirementIds',
    'expectedStatus',
    'isolatedFailureRequirementId',
    'locked',
  ])('never leaks %s to the model', (needle) => {
    expect(userMessage).not.toContain(needle);
  });

  it('does not disclose which keys this case actually imposes', () => {
    // The taxonomy is in the system prompt for every run; the case envelope
    // must not narrow it.
    expect(userMessage).not.toContain('requirementKey');
  });
});

describe('baseline v2 output schema', () => {
  it('accepts a well-formed assessment set', async () => {
    const client = new FakeModelClient([{ text: fullResponse('FAIL') }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: HardBaselinePredictionSchema,
    });
    expect(result.value?.requirementAssessments).toHaveLength(6);
  });

  it('rejects a duplicated requirement key and asks for a repair', async () => {
    const duplicated = JSON.stringify({
      verdict: 'FAIL',
      confidence: 0.5,
      summary: 'Duplicated key.',
      requirementAssessments: [assessment('refund_outcome', 'FAIL'), assessment('refund_outcome', 'PASS')],
      unresolved: [],
    });
    const client = new FakeModelClient([{ text: duplicated }, { text: fullResponse('FAIL') }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: HardBaselinePredictionSchema,
    });
    expect(result.parseErrors[0]).toContain('assessed more than once');
    expect(result.attempts).toHaveLength(2);
    expect(result.value?.requirementAssessments).toHaveLength(6);
  });

  it('rejects an unknown requirement key', async () => {
    const unknown = JSON.stringify({
      verdict: 'FAIL',
      confidence: 0.5,
      summary: 'Unknown key.',
      requirementAssessments: [assessment('vibes_check', 'FAIL')],
      unresolved: [],
    });
    const client = new FakeModelClient([{ text: unknown }, { text: unknown }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: HardBaselinePredictionSchema,
    });
    expect(result.value).toBeNull();
    expect(result.parseErrors.join(' ')).toContain('requirementKey');
  });

  it('rejects an empty assessment list', async () => {
    const empty = JSON.stringify({
      verdict: 'PASS',
      confidence: 0.5,
      summary: 'Nothing assessed.',
      requirementAssessments: [],
      unresolved: [],
    });
    const client = new FakeModelClient([{ text: empty }, { text: empty }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: HardBaselinePredictionSchema,
    });
    expect(result.value).toBeNull();
  });
});

describe('hard baseline run', () => {
  const artifactsDir = tempArtifacts();
  const runId = 'RUN-baseline-hard-development-test';
  const predictionPath = path.join(artifactsDir, 'predictions', `${runId}.json`);
  const reads: Array<{ fileName: string; predictionsWritten: boolean }> = [];

  it('runs the development split and scores it, reading gold only afterwards', async () => {
    const stopObserving = onCaseFileRead(({ fileName }) => {
      reads.push({ fileName, predictionsWritten: existsSync(predictionPath) });
    });
    try {
      const client = new FakeModelClient([{ text: fullResponse('FAIL') }]);
      const run = await runHardBaselinePredictions({
        client,
        split: 'development',
        artifactsDir,
        runId,
      });

      expect(run.predictionFile.dataset).toBe('phantombench-hard-12');
      expect(run.predictionFile.predictions.map((entry) => entry.caseId)).toEqual(
        caseIdsForSplit('development', HARD_SPLITS_DIR),
      );
      expect(run.manifest.datasetName).toBe('phantombench-hard-12');
      expect(run.manifest.datasetHash).toBeNull();
      expect(Object.keys(run.manifest.promptHashes)).toEqual(['prompts/baseline-evaluator/v2.md']);

      const score = scoreHardPredictions({
        predictionPath,
        artifactsDir,
        manifestPath: run.paths.manifestPath,
      });

      expect(score.caseResults).toHaveLength(8);
      expect(existsSync(score.reportMarkdownPath)).toBe(true);

      // Scripted to call everything FAIL: perfect recall, worst-case FVR.
      expect(score.requirementMetrics.safetyViolationRecall).toBe(1);
      expect(score.requirementMetrics.falseViolationRate).toBe(1);
      expect(score.requirementMetrics.completeDiagnosisRate).toBe(0);

      const manifest = EvaluationRunManifestSchema.parse(
        JSON.parse(readFileSync(run.paths.manifestPath, 'utf8')),
      );
      expect(manifest.datasetHash).toBe(score.datasetHash);
      expect(manifest.reportPath).toBe(`reports/${runId}.md`);
    } finally {
      stopObserving();
    }
  });

  it('opened no human-only file before the prediction artifact existed', () => {
    const goldReads = reads.filter((entry) =>
      (HUMAN_ONLY_FILES as readonly string[]).includes(entry.fileName),
    );
    expect(goldReads.length).toBeGreaterThan(0);
    expect(goldReads.every((entry) => entry.predictionsWritten)).toBe(true);
  });

  it('never touched a locked hard case', () => {
    const locked = caseIdsForSplit('locked', HARD_SPLITS_DIR);
    const predictionFile = JSON.parse(readFileSync(predictionPath, 'utf8')) as {
      predictions: Array<{ caseId: string }>;
    };
    for (const entry of predictionFile.predictions) {
      expect(locked).not.toContain(entry.caseId);
    }
  });

  it('did not modify the Core-12 v1 artifacts', () => {
    const repoArtifacts = path.join(HARD_CASES_DIR, '..', '..', '..', 'artifacts');
    const v1Report = path.join(
      repoArtifacts,
      'reports',
      'RUN-baseline-development-live-20260828T222134Z.md',
    );
    if (!existsSync(v1Report)) return;
    const text = readFileSync(v1Report, 'utf8');
    expect(text).toContain('Balanced Verdict Accuracy | 100.0%');
    expect(text).not.toContain('Safety Violation Recall');
  });
});
