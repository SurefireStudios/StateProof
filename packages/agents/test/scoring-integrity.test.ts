import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EvaluationRunManifestSchema } from '@stateproof/core';
import { caseIdsForSplit } from '@stateproof/benchmark';
import { FakeModelClient } from '@stateproof/model-provider';
import {
  type BaselinePredictionFile,
  SplitCoverageError,
  assertSplitCoverage,
  runBaselinePredictions,
  scorePredictions,
} from '@stateproof/agents';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempArtifacts(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stateproof-scoring-'));
  tempRoots.push(root);
  return root;
}

function verdictJson(verdict: 'PASS' | 'FAIL'): string {
  return JSON.stringify({
    verdict,
    confidence: 0.7,
    summary: 'Scripted for testing.',
    evidence: [{ claim: 'checked', source: 'state:final', finding: 'observed' }],
    unresolved: [],
  });
}

function predictionEntry(caseId: string) {
  return {
    caseId,
    prediction: JSON.parse(verdictJson('FAIL')) as unknown,
    parseAttempts: 1,
    parseErrors: [],
    runtimeMs: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    rawResponsePaths: [],
    promptHash: 'a'.repeat(64),
  };
}

function predictionFile(caseIds: readonly string[]): BaselinePredictionFile {
  return {
    schemaVersion: '1.0.0',
    runId: 'RUN-test',
    system: 'baseline',
    split: 'development',
    predictions: caseIds.map(predictionEntry),
  } as BaselinePredictionFile;
}

const developmentCases = caseIdsForSplit('development');

describe('D1 — a report covers exactly its declared split', () => {
  it('accepts a complete development prediction set', () => {
    expect(() => assertSplitCoverage(predictionFile(developmentCases))).not.toThrow();
  });

  it('rejects a missing case', () => {
    const incomplete = predictionFile(developmentCases.slice(0, -1));
    expect(() => assertSplitCoverage(incomplete)).toThrow(SplitCoverageError);
    try {
      assertSplitCoverage(incomplete);
    } catch (error) {
      expect((error as SplitCoverageError).problems.join(' ')).toContain('has no prediction');
    }
  });

  it('rejects a duplicated case', () => {
    const duplicated = predictionFile([...developmentCases, developmentCases[0] as string]);
    try {
      assertSplitCoverage(duplicated);
      throw new Error('expected a SplitCoverageError');
    } catch (error) {
      expect((error as SplitCoverageError).problems.join(' ')).toContain('appears 2 times');
    }
  });

  it('rejects an extra case that is not in the benchmark', () => {
    const extra = predictionFile([...developmentCases, 'PB-Z99']);
    try {
      assertSplitCoverage(extra);
      throw new Error('expected a SplitCoverageError');
    } catch (error) {
      expect((error as SplitCoverageError).problems.join(' ')).toContain('PB-Z99');
    }
  });

  it('rejects a case from the locked split', () => {
    const lockedCase = caseIdsForSplit('locked')[0] as string;
    const leaked = predictionFile([...developmentCases, lockedCase]);
    try {
      assertSplitCoverage(leaked);
      throw new Error('expected a SplitCoverageError');
    } catch (error) {
      expect((error as SplitCoverageError).problems.join(' ')).toContain('belongs to the locked split');
    }
  });

  it('refuses to write a report when coverage fails', () => {
    const artifactsDir = tempArtifacts();
    const predictionPath = path.join(artifactsDir, 'predictions', 'RUN-broken.json');
    mkdirSync(path.dirname(predictionPath), { recursive: true });
    writeFileSync(
      predictionPath,
      JSON.stringify({ ...predictionFile(developmentCases.slice(0, 2)), runId: 'RUN-broken' }, null, 2),
      'utf8',
    );

    expect(() => scorePredictions({ predictionPath, artifactsDir })).toThrow(SplitCoverageError);
    expect(existsSync(path.join(artifactsDir, 'reports', 'RUN-broken.md'))).toBe(false);
  });
});

describe('D2 — the completed manifest is whole', () => {
  const artifactsDir = tempArtifacts();
  const runId = 'RUN-baseline-manifest-test';

  it('records every provenance field and every artifact path exists', async () => {
    const client = new FakeModelClient([{ text: verdictJson('FAIL') }]);
    const run = await runBaselinePredictions({
      client,
      split: 'development',
      artifactsDir,
      runId,
    });

    // Before scoring, the gold-inclusive hash and report path are unknown.
    expect(run.manifest.agentVisibleDatasetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.manifest.datasetHash).toBeNull();
    expect(run.manifest.reportPath).toBeNull();
    expect(run.manifest.packageLockHash).toMatch(/^[0-9a-f]{64}$/);

    const score = scorePredictions({
      predictionPath: run.paths.predictionPath,
      artifactsDir,
      manifestPath: run.paths.manifestPath,
    });

    const manifest = EvaluationRunManifestSchema.parse(
      JSON.parse(readFileSync(run.paths.manifestPath, 'utf8')),
    );

    expect(manifest.datasetHash).toBe(score.datasetHash);
    expect(manifest.datasetHash).not.toBe(manifest.agentVisibleDatasetHash);
    expect(manifest.reportPath).toBe(`reports/${runId}.md`);
    expect(manifest.predictionPath).toBe(`predictions/${runId}.json`);
    expect(manifest.packageLockHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.promptHashes['prompts/baseline-evaluator/v1.md']).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.modelUsage?.calls).toBeGreaterThan(0);
    expect(manifest.modelUsage?.estimatedCostUsd).toBeNull();
    expect(manifest.caseIds).toEqual(developmentCases);

    for (const relative of [
      manifest.predictionPath,
      manifest.reportPath,
      ...manifest.rawResponsePaths,
    ]) {
      expect(existsSync(path.join(artifactsDir, relative as string))).toBe(true);
    }
  });

  it('never writes a credential into an artifact', () => {
    const manifestText = readFileSync(
      path.join(artifactsDir, 'run-manifests', `${runId}.json`),
      'utf8',
    );
    expect(manifestText).not.toContain('apiKey');
    expect(manifestText).not.toContain('ANTHROPIC_API_KEY');
    expect(manifestText).not.toContain('STATEPROOF_ANTHROPIC_API_KEY');
    expect(manifestText).not.toContain('sk-ant');
  });
});
