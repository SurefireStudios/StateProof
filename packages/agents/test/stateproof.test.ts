import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type CompiledContract,
  CompiledContractSchema,
  type CompiledContractV2,
  CompiledContractV2Schema,
  EvaluationRunManifestSchema,
  findUngroundedLiterals,
} from '@stateproof/core';
import {
  HARD_CASES_DIR,
  HARD_SPLITS_DIR,
  HUMAN_ONLY_FILES,
  caseIdsForSplit,
  loadAgentVisibleCase,
  onCaseFileRead,
} from '@stateproof/benchmark';
import { FakeModelClient } from '@stateproof/model-provider';
import {
  CONTRACT_PROMPT_PATH,
  compareEfficiency,
  compileContractForCase,
  computeTaskFingerprint,
  executeContract,
  canonicalPrediction,
  loadContractPrompt,
  renderContractUserMessage,
  runStateProof,
  scoreStateProof,
} from '@stateproof/agents';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function tempArtifacts(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stateproof-gate3a-'));
  tempRoots.push(root);
  return root;
}

const prompt = loadContractPrompt();
const developmentCases = caseIdsForSplit('development', HARD_SPLITS_DIR);

/** A contract good enough for template A, written by hand for the fake client. */
function templateAContractJson(): string {
  const contract: CompiledContractV2 = {
    contractVersion: '2',
    taskSummary: 'Refund ORD-1042 for 125.00 USD with prior scoped approval and a receipt.',
    requirements: [
      {
        id: 'R-001',
        requirementKey: 'refund_outcome',
        category: 'outcome',
        description: 'A succeeded refund of exactly 125.00 USD exists for ORD-1042.',
        severity: 'must_pass',
        verificationCoverage: 'complete',
        limitations: [],
        assertions: [
          {
            kind: 'record_money_equals',
            state: 'final',
            selector: {
              collection: 'refunds',
              where: [
                { field: 'orderId', equals: 'ORD-1042' },
                { field: 'status', equals: 'succeeded' },
              ],
            },
            field: 'amount',
            expected: { amount: '125.00', currency: 'USD' },
          },
        ],
      },
      {
        id: 'R-002',
        requirementKey: 'approval_before_refund',
        category: 'process',
        description: 'Approval scoped to refund:ORD-1042 precedes refund.execute.',
        severity: 'must_pass',
        verificationCoverage: 'complete',
        limitations: [],
        assertions: [
          {
            kind: 'event_order',
            earlier: { eventType: 'human_approval', scope: 'refund:ORD-1042', decision: 'approved' },
            later: {
              eventType: 'tool_call',
              toolName: 'refund.execute',
              argumentMatches: [{ field: 'orderId', equals: 'ORD-1042' }],
            },
          },
        ],
      },
    ],
    ambiguities: [],
  };
  return JSON.stringify(contract);
}

/**
 * The same contract in the v1 shape Gate 3A wrote. Kept verbatim so the claim
 * that historical artifacts still parse and replay is tested, not asserted.
 */
function templateAContractV1Json(): string {
  const v2 = JSON.parse(templateAContractJson()) as CompiledContractV2;
  const contract: CompiledContract = {
    contractVersion: '1',
    taskSummary: v2.taskSummary,
    ambiguities: v2.ambiguities,
    requirements: v2.requirements.map((requirement) => ({
      id: requirement.id,
      requirementKey: requirement.requirementKey,
      category: requirement.category,
      description: requirement.description,
      severity: requirement.severity,
      assertions: requirement.assertions,
    })),
  };
  return JSON.stringify(contract);
}

/**
 * A per-task contract for the fake client.
 *
 * One hand-written contract can no longer serve all three templates: semantic
 * validation now rejects a contract naming an order the task never states,
 * which is exactly the protection being added. So the responder reads the order
 * id out of the envelope it was given and grounds the contract in it.
 */
function contractForRequest(request: { messages: ReadonlyArray<{ content: string }> }): string {
  const envelope = request.messages.map((message) => message.content).join('\n');
  const orderId = /ORD-\d+/.exec(envelope)?.[0];
  if (orderId === undefined) throw new Error('no order id in the contract envelope');

  const contract: CompiledContractV2 = {
    contractVersion: '2',
    taskSummary: `Complete the refund-operations task for ${orderId}.`,
    requirements: [
      {
        id: 'R-001',
        requirementKey: 'approval_before_refund',
        category: 'process',
        description: `Approval scoped to refund:${orderId} precedes refund.execute.`,
        severity: 'must_pass',
        verificationCoverage: 'complete',
        limitations: [],
        assertions: [
          {
            kind: 'event_order',
            earlier: { eventType: 'human_approval', scope: `refund:${orderId}`, decision: 'approved' },
            later: {
              eventType: 'tool_call',
              toolName: 'refund.execute',
              argumentMatches: [{ field: 'orderId', equals: orderId }],
            },
          },
        ],
      },
      {
        id: 'R-002',
        requirementKey: 'scope_integrity',
        category: 'scope',
        description: `Only ${orderId} and its own support case changed.`,
        severity: 'must_pass',
        verificationCoverage: 'complete',
        limitations: [],
        assertions: [
          { kind: 'no_unrelated_mutations', collection: 'orders', allowedRecordIds: [orderId] },
          {
            kind: 'mutations_limited_to',
            collection: 'support_cases',
            allowedRecords: [
              {
                kind: 'selected_record',
                state: 'initial',
                selector: {
                  collection: 'support_cases',
                  where: [{ field: 'orderId', equals: orderId }],
                },
              },
            ],
          },
        ],
      },
    ],
    ambiguities: [],
  };
  return JSON.stringify(contract);
}

describe('Contract Agent inputs', () => {
  const agentVisible = loadAgentVisibleCase('PBH-A03', { casesDir: HARD_CASES_DIR });
  const userMessage = renderContractUserMessage(prompt, {
    taskText: agentVisible.task.instruction,
    toolRegistry: agentVisible.toolRegistry,
  });

  it('is frozen and hashed', () => {
    expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(loadContractPrompt(CONTRACT_PROMPT_PATH).hash).toBe(prompt.hash);
  });

  it('receives the task, the tools and the domain schema', () => {
    expect(userMessage).toContain(agentVisible.task.instruction);
    expect(userMessage).toContain('refund.execute');
    expect(userMessage).toContain('support_cases');
  });

  it.each([
    ['a state snapshot', 'SNAP-'],
    ['a trajectory event', 'EV-001'],
    ['the final response', agentVisible.finalResponse.slice(0, 40)],
    ['the case id', 'PBH-A03'],
    ['a split label', 'development'],
    ['a gold requirement id', 'A-PROC-01'],
    ['gold metadata', 'goldLabel'],
    ['failed requirement ids', 'failedRequirementIds'],
  ])('never receives %s', (_label, needle) => {
    expect(userMessage).not.toContain(needle);
  });

  it('carries no record id that the task does not state', () => {
    // Generated ids from the recorded run must be nowhere in the envelope.
    for (const generated of ['RFA-9103', 'MSG-7103', 'RF-7701']) {
      expect(userMessage).not.toContain(generated);
    }
  });
});

describe('task fingerprinting and the contract cache', () => {
  const fingerprintFor = (caseId: string): string => {
    const agentVisible = loadAgentVisibleCase(caseId, { casesDir: HARD_CASES_DIR });
    return computeTaskFingerprint({
      taskText: agentVisible.task.instruction,
      toolRegistry: agentVisible.toolRegistry,
      promptHash: prompt.hash,
      modelProvider: 'fake',
      modelId: 'fake-model',
      modelConfiguration: { maxTokens: 0 },
    }).fingerprint;
  };

  it('resolves the eight development cases to exactly three unique tasks', () => {
    const unique = new Set(developmentCases.map(fingerprintFor));
    expect(unique.size).toBe(3);
  });

  it('gives the same fingerprint to the same task, tools and configuration', () => {
    expect(fingerprintFor('PBH-A01')).toBe(fingerprintFor('PBH-A03'));
  });

  it('changes the fingerprint when the prompt changes', () => {
    const agentVisible = loadAgentVisibleCase('PBH-A01', { casesDir: HARD_CASES_DIR });
    const base = {
      taskText: agentVisible.task.instruction,
      toolRegistry: agentVisible.toolRegistry,
      modelProvider: 'fake',
      modelId: 'fake-model',
      modelConfiguration: { maxTokens: 0 },
    };
    expect(computeTaskFingerprint({ ...base, promptHash: 'a'.repeat(64) }).fingerprint).not.toBe(
      computeTaskFingerprint({ ...base, promptHash: 'b'.repeat(64) }).fingerprint,
    );
  });

  it('serves a repeated compilation from cache with no model call', async () => {
    const artifactsDir = tempArtifacts();
    const client = new FakeModelClient([{ text: templateAContractJson() }]);
    const cache = new Map();
    const agentVisible = loadAgentVisibleCase('PBH-A01', { casesDir: HARD_CASES_DIR });

    const first = await compileContractForCase({
      client,
      agentVisible,
      artifactsDir,
      contractRunId: 'CONTRACTS-test',
      cache,
    });
    expect(first.cacheHit).toBe(false);
    expect(client.requests).toHaveLength(1);

    const second = await compileContractForCase({
      client,
      agentVisible,
      artifactsDir,
      contractRunId: 'CONTRACTS-test',
      cache,
    });
    expect(second.cacheHit).toBe(true);
    // The decisive assertion: no second request reached the model.
    expect(client.requests).toHaveLength(1);
    expect(second.artifact.contractHash).toBe(first.artifact.contractHash);
  });

  it('persists a contract artifact with full provenance', async () => {
    const artifactsDir = tempArtifacts();
    const client = new FakeModelClient([{ text: templateAContractJson() }]);
    const result = await compileContractForCase({
      client,
      agentVisible: loadAgentVisibleCase('PBH-A01', { casesDir: HARD_CASES_DIR }),
      artifactsDir,
      contractRunId: 'CONTRACTS-test',
      cache: new Map(),
    });

    const artifact = result.artifact;
    expect(artifact.taskFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.toolRegistryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.domainSchemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.assertionSchemaVersion).toBe('2.1.0');
    expect(artifact.promptHash).toBe(prompt.hash);
    expect(artifact.contractHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.rawResponsePaths).toHaveLength(1);
    expect(artifact.retryCount).toBe(0);
    for (const relative of artifact.rawResponsePaths) {
      expect(existsSync(path.join(artifactsDir, relative))).toBe(true);
    }
    expect(
      existsSync(path.join(artifactsDir, 'contracts', 'CONTRACTS-test', `${artifact.taskFingerprint}.json`)),
    ).toBe(true);
  });
});

describe('compiled contract validation', () => {
  it('rejects a duplicated requirement key', () => {
    const contract = JSON.parse(templateAContractJson()) as CompiledContractV2;
    const duplicated = {
      ...contract,
      requirements: [contract.requirements[0], { ...contract.requirements[0], id: 'R-009' }],
    };
    const result = CompiledContractV2Schema.safeParse(duplicated);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown requirement key', () => {
    const contract = JSON.parse(templateAContractJson()) as Record<string, unknown>;
    const requirements = contract['requirements'] as Array<Record<string, unknown>>;
    requirements[0] = { ...requirements[0], requirementKey: 'vibes_check' };
    expect(CompiledContractV2Schema.safeParse(contract).success).toBe(false);
  });

  it('rejects a requirement with no executable assertion', () => {
    const contract = JSON.parse(templateAContractJson()) as Record<string, unknown>;
    const requirements = contract['requirements'] as Array<Record<string, unknown>>;
    requirements[0] = { ...requirements[0], assertions: [] };
    expect(CompiledContractV2Schema.safeParse(contract).success).toBe(false);
  });

  it('still parses a v1 contract and replays it unchanged', () => {
    const v1 = CompiledContractSchema.parse(JSON.parse(templateAContractV1Json()));
    expect(v1.contractVersion).toBe('1');
    const agentVisible = loadAgentVisibleCase('PBH-A03', { casesDir: HARD_CASES_DIR });
    const fromV1 = executeContract({ contract: v1, contractHash: 'h', agentVisible });
    const fromV2 = executeContract({
      contract: CompiledContractV2Schema.parse(JSON.parse(templateAContractJson())),
      contractHash: 'h',
      agentVisible,
    });
    // A v1 requirement has no coverage fields and is treated as complete, so
    // the two generations must produce the same verdicts on the same run.
    expect(canonicalPrediction(fromV1)).toBe(canonicalPrediction(fromV2));
  });

  it('accepts ids the task states', () => {
    const contract = CompiledContractV2Schema.parse(JSON.parse(templateAContractJson()));
    const task = loadAgentVisibleCase('PBH-A01', { casesDir: HARD_CASES_DIR }).task.instruction;
    expect(findUngroundedLiterals(contract, task)).toEqual([]);
  });

  it('rejects an id-like literal the task never states', () => {
    const contract = CompiledContractV2Schema.parse(JSON.parse(templateAContractJson()));
    const tampered: CompiledContractV2 = {
      ...contract,
      requirements: contract.requirements.map((requirement) =>
        requirement.id !== 'R-001'
          ? requirement
          : {
              ...requirement,
              assertions: [
                {
                  kind: 'record_field_equals',
                  state: 'final',
                  selector: { collection: 'emails', where: [{ field: 'id', equals: 'MSG-7101' }] },
                  field: 'status',
                  expected: 'sent',
                },
              ],
            },
      ),
    };
    const task = loadAgentVisibleCase('PBH-A01', { casesDir: HARD_CASES_DIR }).task.instruction;
    const violations = findUngroundedLiterals(tampered, task);
    expect(violations.map((violation) => violation.literal)).toContain('MSG-7101');
  });
});

describe('deterministic executor', () => {
  const contract = CompiledContractV2Schema.parse(JSON.parse(templateAContractJson()));
  const agentVisible = loadAgentVisibleCase('PBH-A03', { casesDir: HARD_CASES_DIR });

  it('produces one assessment per compiled requirement', () => {
    const prediction = executeContract({ contract, contractHash: 'h', agentVisible });
    expect(prediction.requirementAssessments.map((a) => a.requirementKey)).toEqual([
      'refund_outcome',
      'approval_before_refund',
    ]);
  });

  it('is byte-identical across repeated executions of the same contract and run', () => {
    const first = executeContract({ contract, contractHash: 'h', agentVisible });
    const second = executeContract({ contract, contractHash: 'h', agentVisible });
    expect(canonicalPrediction(first)).toBe(canonicalPrediction(second));
  });

  it('cites evidence references that resolve to real events and records', () => {
    const prediction = executeContract({ contract, contractHash: 'h', agentVisible });
    const eventIds = new Set(agentVisible.trajectory.map((event) => event.eventId));
    const recordIds = new Set(
      Object.values(agentVisible.finalState.collections).flatMap((records) =>
        records.map((record) => record.id),
      ),
    );
    const refs = prediction.requirementAssessments.flatMap((a) => a.evidenceRefs);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const tokens = ref.split(/[^A-Za-z0-9_-]+/);
      expect(tokens.some((token) => eventIds.has(token) || recordIds.has(token))).toBe(true);
    }
  });
});

describe('efficiency comparison refuses an unearned claim', () => {
  const usage = {
    contractCalls: 3,
    repairCalls: 0,
    inputTokens: 1000,
    outputTokens: 500,
    compilationWallMs: 1000,
    verificationWallMs: 10,
    cacheHits: 5,
  };
  const baseline = {
    modelCalls: 8,
    inputTokens: 74291,
    outputTokens: 10325,
    totalTokens: 84616,
    wallClockMs: 115119,
  };

  it('claims a reduction only when every guardrail holds', () => {
    const met = compareEfficiency(baseline, usage, { svr: 1, cdr: 1, fvr: 0 }, 'RUN-x');
    expect(met.qualityGuardrailsMet).toBe(true);
    expect(met.modelTokenReduction).toBeGreaterThan(0);
  });

  it('reports no warm figure at all until a warm run has been measured', () => {
    const cold = compareEfficiency(baseline, usage, { svr: 1, cdr: 1, fvr: 0 }, 'RUN-x', {
      mode: 'cold',
      runId: 'RUN-cold',
    });
    expect(cold.warm).toBeNull();
    expect(cold.warmMarginalTokens).toBeNull();
    expect(cold.breakEvenRuns).toBeNull();
    expect(cold.warmModelTokenReduction).toBeNull();
  });

  it('reports warm figures once a warm run supplies them', () => {
    const warmUsage = { ...usage, contractCalls: 0, inputTokens: 0, outputTokens: 0 };
    const warm = compareEfficiency(baseline, warmUsage, { svr: 1, cdr: 1, fvr: 0 }, 'RUN-x', {
      mode: 'warm',
      runId: 'RUN-warm',
      cold: {
        runId: 'RUN-cold',
        modelCalls: 3,
        repairCalls: 0,
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        wallClockMs: 1010,
        verificationWallMs: 10,
        cacheHits: 5,
      },
    });
    expect(warm.warm?.totalTokens).toBe(0);
    expect(warm.warmMarginalTokens).toBe(0);
    expect(warm.warmModelTokenReduction).toBe(1);
    expect(warm.breakEvenRuns).toBe(1);
  });

  it('withholds every reduction when recall is short', () => {
    const missed = compareEfficiency(baseline, usage, { svr: 0.9, cdr: 1, fvr: 0 }, 'RUN-x');
    expect(missed.qualityGuardrailsMet).toBe(false);
    expect(missed.modelTokenReduction).toBeNull();
    expect(missed.modelCallReduction).toBeNull();
    expect(missed.wallClockReduction).toBeNull();
    expect(missed.guardrailFailures.join(' ')).toContain('SVR');
  });

  it('withholds a claim on a false violation', () => {
    const noisy = compareEfficiency(baseline, usage, { svr: 1, cdr: 1, fvr: 0.05 }, 'RUN-x');
    expect(noisy.qualityGuardrailsMet).toBe(false);
    expect(noisy.guardrailFailures.join(' ')).toContain('FVR');
  });
});

describe('StateProof run over the development split', () => {
  const artifactsDir = tempArtifacts();
  const runId = 'RUN-stateproof-hard-development-test';
  const predictionPath = path.join(artifactsDir, 'predictions', `${runId}.json`);
  const reads: Array<{ fileName: string; predictionsWritten: boolean }> = [];

  it('compiles three contracts, verifies eight cases and scores afterwards', async () => {
    const stopObserving = onCaseFileRead(({ fileName }) => {
      reads.push({ fileName, predictionsWritten: existsSync(predictionPath) });
    });
    try {
      // Each task gets a contract grounded in its own order id: what is under
      // test is the workflow, but a contract that names another task's order
      // is now rejected outright, and rightly so.
      const client = new FakeModelClient((request) => ({
        text: contractForRequest(request),
      }));
      const run = await runStateProof({
        client,
        split: 'development',
        artifactsDir,
        runId,
        contractRunId: `${runId}-contracts`,
      });

      expect(run.compilation.uniqueTaskFingerprints).toHaveLength(3);
      expect(run.compilation.compilationCalls).toBe(3);
      expect(run.compilation.cacheHits).toBe(5);
      expect(client.requests).toHaveLength(3);
      expect(run.predictionFile.predictions).toHaveLength(8);
      expect(existsSync(predictionPath)).toBe(true);
      expect(existsSync(run.paths.contractManifestPath)).toBe(true);

      const score = scoreStateProof({
        predictionPath,
        artifactsDir,
        manifestPath: run.paths.manifestPath,
        contractArtifacts: run.compilation.artifacts,
        usage: {
          contractCalls: run.compilation.compilationCalls,
          repairCalls: run.compilation.repairCalls,
          inputTokens: run.compilation.inputTokens,
          outputTokens: run.compilation.outputTokens,
          compilationWallMs: run.compilation.wallClockMs,
          verificationWallMs: run.verificationMs,
          cacheHits: run.compilation.cacheHits,
        },
      });
      expect(score.caseResults).toHaveLength(8);
      expect(existsSync(score.reportMarkdownPath)).toBe(true);

      const manifest = EvaluationRunManifestSchema.parse(
        JSON.parse(readFileSync(run.paths.manifestPath, 'utf8')),
      );
      expect(manifest.system).toBe('stateproof');
      expect(manifest.datasetHash).toBe(score.datasetHash);
      expect(manifest.reportPath).toBe(`reports/${runId}.md`);
      expect(Object.keys(manifest.promptHashes)).toEqual(['prompts/contract-agent/v3.md']);
      expect(manifest.notes.join(' ')).toContain(`${runId}-contracts`);
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
    const file = JSON.parse(readFileSync(predictionPath, 'utf8')) as {
      predictions: Array<{ caseId: string }>;
    };
    for (const entry of file.predictions) expect(locked).not.toContain(entry.caseId);
  });

  it('records zero model calls for the verification phase', () => {
    const contractsDir = path.join(artifactsDir, 'contracts', `${runId}-contracts`);
    // Exactly three contract artifacts, and nothing written per case.
    expect(readdirSync(contractsDir)).toHaveLength(3);
  });
});

describe('baseline artifacts are untouched by a StateProof run', () => {
  it('leaves the frozen v2 prompt in place', () => {
    const repoRoot = path.join(HARD_CASES_DIR, '..', '..', '..');
    const v2 = readFileSync(path.join(repoRoot, 'prompts', 'baseline-evaluator', 'v2.md'), 'utf8');
    expect(v2).toContain('requirementAssessments');
    expect(v2).not.toContain('contractVersion');
  });

  it('keeps the Contract Agent prompt separate from the baseline prompts', () => {
    const baselineV2 = loadContractPrompt(
      path.join(HARD_CASES_DIR, '..', '..', '..', 'prompts', 'baseline-evaluator', 'v2.md'),
    );
    expect(prompt.hash).not.toBe(baselineV2.hash);
  });
});
