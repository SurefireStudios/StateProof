import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EvaluationRunManifestSchema } from '@stateproof/core';
import {
  HUMAN_ONLY_FILES,
  caseIdsForSplit,
  loadAgentVisibleCase,
  onCaseFileRead,
} from '@stateproof/benchmark';
import { FakeModelClient, requestStructured } from '@stateproof/model-provider';
import {
  BaselinePredictionSchema,
  loadBaselinePrompt,
  renderBaselineUserMessage,
  runBaselinePredictions,
  scorePredictions,
} from '@stateproof/agents';

const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempArtifacts(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stateproof-artifacts-'));
  tempRoots.push(root);
  return root;
}

function verdictJson(verdict: 'PASS' | 'FAIL' | 'NEEDS_REVIEW'): string {
  return JSON.stringify({
    verdict,
    confidence: 0.8,
    summary: `Scripted ${verdict} for testing.`,
    evidence: [{ claim: 'checked', source: 'state:final', finding: 'observed' }],
    unresolved: [],
  });
}

const prompt = loadBaselinePrompt();

describe('baseline prompt envelope', () => {
  const agentVisible = loadAgentVisibleCase('PB-A03');
  const userMessage = renderBaselineUserMessage(prompt, agentVisible);

  it('is frozen and hashed', () => {
    expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(loadBaselinePrompt().hash).toBe(prompt.hash);
  });

  it('carries the task, response, states and trajectory', () => {
    expect(userMessage).toContain(agentVisible.task.instruction);
    expect(userMessage).toContain('dana@example.com');
    expect(userMessage).toContain('refund.execute');
    expect(userMessage).toContain('<final_state>');
  });

  it('describes read-only evidence sources only', () => {
    expect(userMessage).toContain('orders.get');
    // Write tools are not offered as evidence sources.
    const evidenceBlock = userMessage.slice(userMessage.indexOf('<read_only_evidence_sources>'));
    expect(evidenceBlock).not.toContain('- refund.execute');
    expect(evidenceBlock).not.toContain('- email.send');
  });

  it.each([
    'PB-A03',
    'A-PROC-01',
    'goldLabel',
    'expectedStatus',
    'isolatedFailureRequirementId',
    'development',
    'locked',
    'approval_after_protected_action',
  ])('never leaks %s to the model', (needle) => {
    expect(userMessage).not.toContain(needle);
  });
});

describe('structured output with one repair retry', () => {
  it('accepts a valid first response without retrying', async () => {
    const client = new FakeModelClient([{ text: verdictJson('FAIL') }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: BaselinePredictionSchema,
    });
    expect(result.value?.verdict).toBe('FAIL');
    expect(result.attempts).toHaveLength(1);
    expect(result.parseErrors).toEqual([]);
  });

  it('repairs once and records the validation error', async () => {
    const client = new FakeModelClient([
      { text: '{"verdict": "MAYBE"}' },
      { text: verdictJson('PASS') },
    ]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: BaselinePredictionSchema,
    });
    expect(result.value?.verdict).toBe('PASS');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1]?.kind).toBe('repair');
    expect(result.parseErrors).toHaveLength(1);
    expect(client.requests[1]?.messages.at(-1)?.content).toContain('did not match the required');
  });

  it('gives up after one repair and reports no value', async () => {
    const client = new FakeModelClient([{ text: 'not json' }, { text: 'still not json' }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: BaselinePredictionSchema,
    });
    expect(result.value).toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(result.parseErrors).toHaveLength(2);
  });

  it('tolerates a fenced JSON block without spending the repair budget', async () => {
    const client = new FakeModelClient([{ text: `\`\`\`json\n${verdictJson('PASS')}\n\`\`\`` }]);
    const result = await requestStructured({
      client,
      system: 'system',
      userMessage: 'user',
      schema: BaselinePredictionSchema,
    });
    expect(result.value?.verdict).toBe('PASS');
    expect(result.attempts).toHaveLength(1);
  });
});

describe('baseline run over the development split', () => {
  const artifactsDir = tempArtifacts();
  const runId = 'RUN-baseline-development-test';
  const predictionPath = path.join(artifactsDir, 'predictions', `${runId}.json`);

  /** Every guarded case-file read, tagged with whether predictions existed yet. */
  const reads: Array<{ fileName: string; predictionsWritten: boolean }> = [];

  it('runs, scores and reports without reading gold data too early', async () => {
    const stopObserving = onCaseFileRead(({ fileName }) => {
      reads.push({ fileName, predictionsWritten: existsSync(predictionPath) });
    });

    try {
      const client = new FakeModelClient((_request, index) =>
        // Both attempts of the first case are malformed, so the unparsed path
        // is exercised end to end.
        index < 2 ? { text: '{"verdict": "???"}' } : { text: verdictJson('FAIL') },
      );

      const run = await runBaselinePredictions({
        client,
        split: 'development',
        artifactsDir,
        runId,
      });

      expect(run.runId).toBe(runId);
      expect(existsSync(predictionPath)).toBe(true);
      expect(run.predictionFile.predictions.map((entry) => entry.caseId)).toEqual(
        caseIdsForSplit('development'),
      );

      const score = scorePredictions({ predictionPath, artifactsDir });
      expect(score.caseResults).toHaveLength(8);
      expect(existsSync(score.reportMarkdownPath)).toBe(true);
      expect(existsSync(score.reportJsonPath)).toBe(true);

      // Metrics are computed from the artifacts, never hardcoded.
      const reportJson = JSON.parse(readFileSync(score.reportJsonPath, 'utf8')) as {
        metrics: { caseCount: number; goldPassCount: number; goldFailCount: number };
      };
      expect(reportJson.metrics.caseCount).toBe(8);
      expect(reportJson.metrics.goldPassCount).toBe(4);
      expect(reportJson.metrics.goldFailCount).toBe(4);

      const manifest = EvaluationRunManifestSchema.parse(
        JSON.parse(readFileSync(run.paths.manifestPath, 'utf8')),
      );
      expect(manifest.splits).toEqual(['development']);
      expect(manifest.caseIds).toHaveLength(8);
      expect(Object.keys(manifest.promptHashes)).toEqual(['prompts/baseline-evaluator/v1.md']);
      // The prediction phase records only what the model was shown; the
      // gold-inclusive hash is the scoring phase's job.
      expect(manifest.agentVisibleDatasetHash).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.datasetHash).toBeNull();
      expect(manifest.modelProvider).toBe('fake');
    } finally {
      stopObserving();
    }
  });

  it('read no human-only file before the prediction artifact existed', () => {
    const goldReads = reads.filter((entry) =>
      (HUMAN_ONLY_FILES as readonly string[]).includes(entry.fileName),
    );
    expect(goldReads.length).toBeGreaterThan(0);
    expect(goldReads.every((entry) => entry.predictionsWritten)).toBe(true);

    const earlyGoldReads = reads
      .filter((entry) => !entry.predictionsWritten)
      .map((entry) => entry.fileName);
    for (const fileName of HUMAN_ONLY_FILES) {
      expect(earlyGoldReads).not.toContain(fileName);
    }
  });

  it('records the unparsed case rather than dropping it', () => {
    const score = scorePredictions({ predictionPath, artifactsDir });
    expect(score.unparsedCaseIds).toHaveLength(1);
    const unparsed = score.caseResults.find(
      (result) => result.caseId === score.unparsedCaseIds[0],
    );
    expect(unparsed?.predictedVerdict).toBe('NEEDS_REVIEW');
    expect(unparsed?.unsafeFalseCompletion).toBe(false);
    expect(score.metrics.caseCount).toBe(8);
  });

  it('captures a raw response file for every attempt', () => {
    const predictionFile = JSON.parse(readFileSync(predictionPath, 'utf8')) as {
      predictions: Array<{ caseId: string; parseAttempts: number; rawResponsePaths: string[] }>;
    };
    for (const entry of predictionFile.predictions) {
      const attemptFiles = entry.rawResponsePaths.filter((file) => file.includes('-attempt-'));
      expect(attemptFiles).toHaveLength(entry.parseAttempts);
      for (const file of entry.rawResponsePaths) {
        expect(existsSync(path.join(artifactsDir, file))).toBe(true);
      }
    }
  });
});
