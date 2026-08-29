import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeModelClient } from '@stateproof/model-provider';
import { STATEPROOF_STAGE_PREFIX, runStateProof, stateProofStage } from '@stateproof/agents';
import { CompiledContractV2Schema } from '@stateproof/core';
import { inCheckout } from './checkout';

/**
 * Gate 4A keeps two promises that are easy to break quietly: future runs are
 * labelled correctly, and the historical runs they replaced are not touched to
 * make that true retroactively.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

const GROUNDED_CONTRACT = (orderId: string, recipient: string): string =>
  JSON.stringify(
    CompiledContractV2Schema.parse({
      contractVersion: '2',
      taskSummary: `Stage-label test for ${orderId}.`,
      ambiguities: [],
      requirements: [
        {
          id: 'R-001',
          requirementKey: 'customer_message_outcome',
          category: 'outcome',
          description: 'A message was sent.',
          severity: 'must_pass',
          verificationCoverage: 'complete',
          limitations: [],
          assertions: [
            {
              kind: 'record_exists_matching',
              state: 'final',
              collection: 'emails',
              where: [
                { field: 'to', equals: recipient },
                { field: 'relatedOrderId', equals: orderId },
                { field: 'status', equals: 'sent' },
                {
                  field: 'refundId',
                  equalsSelectedRecordId: {
                    state: 'final',
                    selector: {
                      collection: 'refunds',
                      where: [
                        { field: 'orderId', equals: orderId },
                        { field: 'status', equals: 'succeeded' },
                      ],
                    },
                  },
                },
              ],
              minCount: 1,
            },
          ],
        },
      ],
    }),
  );

function client(): FakeModelClient {
  return new FakeModelClient((request) => {
    const envelope = request.messages.map((message) => message.content).join('\n');
    const orderId = /ORD-\d+/.exec(envelope)?.[0];
    const recipient = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(envelope)?.[0];
    if (orderId === undefined || recipient === undefined) throw new Error('unusable envelope');
    return { text: GROUNDED_CONTRACT(orderId, recipient), usage: { inputTokens: 10, outputTokens: 5 } };
  });
}

describe('run stage labels', () => {
  it('names the current gate', () => {
    expect(STATEPROOF_STAGE_PREFIX).toBe('gate-3c-stateproof');
    expect(stateProofStage('development', 'cold')).toBe('gate-3c-stateproof-development-cold');
    expect(stateProofStage('development', 'warm')).toBe('gate-3c-stateproof-development-warm');
  });

  it('stamps a new run with the corrected label', async () => {
    const artifactsDir = tempDir('stateproof-stage-');
    const run = await runStateProof({
      client: client(),
      split: 'development',
      artifactsDir,
      runId: 'RUN-stage-label',
    });
    expect(run.manifest.stage).toBe('gate-3c-stateproof-development-cold');
    expect(run.manifest.stage).not.toContain('gate-3b');
  });

  it('leaves the mislabelled historical manifest exactly as it was written', () => {
    // Rewriting a recorded run to look tidier is the habit this project exists
    // to catch, so the stale label stays and is documented instead.
    const historical = JSON.parse(
      readFileSync(
        path.join(
          REPO_ROOT,
          'artifacts',
          'run-manifests',
          'RUN-stateproof-hard-development-cold-20260829T022133Z.json',
        ),
        'utf8',
      ),
    ) as { stage: string };
    expect(historical.stage).toBe('gate-3b-stateproof-development-cold');
  });

  it('documents that label as cosmetic', () => {
    const limitations = readFileSync(path.join(REPO_ROOT, 'docs', 'limitations.md'), 'utf8');
    expect(limitations).toContain('gate-3b-stateproof-development-cold');
    expect(limitations.toLowerCase()).toContain('cosmetic');
  });
});

describe.skipIf(!inCheckout(REPO_ROOT))('no credential reaches a committed file', () => {
  it('finds no credential-shaped string in any tracked artifact or prompt', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '--', 'artifacts', 'prompts', 'submission', 'benchmarks', 'docs'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(tracked.length).toBeGreaterThan(20);

    for (const relativePath of tracked) {
      const text = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      expect(text, relativePath).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
      // The variable may be named; it must never carry a value.
      expect(text, relativePath).not.toMatch(/STATEPROOF_ANTHROPIC_API_KEY['"]?\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/);
    }
  });

  it('tracks no .env file of any kind', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes('.env'));
    expect(tracked).toEqual(['.env.example']);
    expect(readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8')).toContain(
      'STATEPROOF_ANTHROPIC_API_KEY=',
    );
  });
});

describe('historical artifacts are untouched', () => {
  it('reports no modification or deletion under artifacts, prompts or benchmarks', () => {
    // This suite also runs inside an extracted release package, which is not a
    // checkout: there is nothing to compare against there, and the archive was
    // built from a clean tree in the first place.
    let status: string;
    try {
      status = execFileSync(
        'git',
        ['status', '--porcelain', '--', 'artifacts', 'prompts', 'benchmarks'],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      return;
    }

    const touched = status
      .split('\n')
      .filter((line) => line.trim() !== '')
      .filter((line) => !line.startsWith('??'))
      // Regenerated aggregates, not run records.
      .filter((line) => !line.includes('development-comparison.md'))
      .filter((line) => !line.includes('artifacts/submission/'));
    expect(touched).toEqual([]);
  });
});
