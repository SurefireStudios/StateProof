import { describe, expect, it } from 'vitest';
import {
  CaseResultSchema,
  ContractRequirementSchema,
  EvaluationRunManifestSchema,
  MoneySchema,
  StateSnapshotSchema,
  TaskSpecSchema,
  ToolRegistrySchema,
  TrajectorySchema,
  normalizeAmount,
} from '@stateproof/core';

const validTask = {
  schemaVersion: '1.0.0',
  taskId: 'TASK-X',
  domain: 'refund-operations',
  title: 'Refund something',
  instruction: 'Refund order ORD-1 for 10.00 USD.',
  issuedBy: 'ops@example.com',
  issuedAt: '2025-03-04T09:00:00.000Z',
};

describe('TaskSpecSchema', () => {
  it('accepts a well-formed task', () => {
    expect(TaskSpecSchema.parse(validTask).taskId).toBe('TASK-X');
  });

  it('rejects a timestamp without millisecond precision', () => {
    const result = TaskSpecSchema.safeParse({ ...validTask, issuedAt: '2025-03-04T09:00:00Z' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields so fixtures cannot smuggle in extra data', () => {
    const result = TaskSpecSchema.safeParse({ ...validTask, goldVerdict: 'FAIL' });
    expect(result.success).toBe(false);
  });
});

describe('MoneySchema', () => {
  it('requires exactly two fraction digits', () => {
    expect(MoneySchema.safeParse({ amount: '125.00', currency: 'USD' }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: '125.0', currency: 'USD' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: 125, currency: 'USD' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '125.00', currency: 'usd' }).success).toBe(false);
  });

  it('normalizes leading zeros and negative zero', () => {
    expect(normalizeAmount('0125.00')).toBe('125.00');
    expect(normalizeAmount('-0.00')).toBe('0.00');
  });
});

describe('ToolRegistrySchema', () => {
  const tool = {
    name: 'orders.get',
    description: 'Read an order.',
    access: 'read',
    parameters: { type: 'object' },
  };

  it('accepts a registry with unique tool names', () => {
    expect(ToolRegistrySchema.parse({ schemaVersion: '1.0.0', tools: [tool] }).tools).toHaveLength(1);
  });

  it('rejects duplicate tool names', () => {
    const result = ToolRegistrySchema.safeParse({ schemaVersion: '1.0.0', tools: [tool, tool] });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown access level', () => {
    const result = ToolRegistrySchema.safeParse({
      schemaVersion: '1.0.0',
      tools: [{ ...tool, access: 'admin' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('StateSnapshotSchema', () => {
  const base = {
    schemaVersion: '1.0.0',
    snapshotId: 'SNAP-1',
    label: 'initial',
    capturedAt: '2025-03-04T09:00:00.000Z',
  };

  it('accepts collections of records', () => {
    const parsed = StateSnapshotSchema.parse({
      ...base,
      collections: { orders: [{ id: 'ORD-1', fields: { status: 'delivered' } }] },
    });
    expect(parsed.collections['orders']).toHaveLength(1);
  });

  it('rejects duplicate record ids inside one collection', () => {
    const result = StateSnapshotSchema.safeParse({
      ...base,
      collections: {
        orders: [
          { id: 'ORD-1', fields: {} },
          { id: 'ORD-1', fields: {} },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('TrajectorySchema', () => {
  const event = (seq: number, timestamp: string) => ({
    eventId: `EV-${seq}`,
    seq,
    timestamp,
    type: 'agent_message',
    role: 'assistant',
    content: 'hello',
  });

  it('accepts a gap-free ascending trajectory', () => {
    const parsed = TrajectorySchema.parse([
      event(1, '2025-03-04T09:00:00.000Z'),
      event(2, '2025-03-04T09:01:00.000Z'),
    ]);
    expect(parsed).toHaveLength(2);
  });

  it('rejects a gap in the sequence', () => {
    const result = TrajectorySchema.safeParse([
      event(1, '2025-03-04T09:00:00.000Z'),
      event(3, '2025-03-04T09:01:00.000Z'),
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects timestamps that move backwards', () => {
    const result = TrajectorySchema.safeParse([
      event(1, '2025-03-04T09:05:00.000Z'),
      event(2, '2025-03-04T09:01:00.000Z'),
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    const result = TrajectorySchema.safeParse([
      { eventId: 'EV-1', seq: 1, timestamp: '2025-03-04T09:00:00.000Z', type: 'telepathy' },
    ]);
    expect(result.success).toBe(false);
  });
});

describe('ContractRequirementSchema', () => {
  const requirement = {
    requirementId: 'A-OUT-01',
    category: 'outcome',
    description: 'Something must be true.',
    assertions: [],
    evidence: { sources: ['final_state'], strategy: 'Read the final state.' },
    severity: 'high',
    mustPass: true,
    ambiguities: [],
  };

  it('accepts a requirement with no machine-checkable assertion', () => {
    expect(ContractRequirementSchema.parse(requirement).assertions).toEqual([]);
  });

  it('rejects a malformed requirement id', () => {
    const result = ContractRequirementSchema.safeParse({ ...requirement, requirementId: 'r1' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown assertion kind', () => {
    const result = ContractRequirementSchema.safeParse({
      ...requirement,
      assertions: [{ kind: 'vibes', selector: { collection: 'orders', where: [] } }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a selector with no match criteria', () => {
    const result = ContractRequirementSchema.safeParse({
      ...requirement,
      assertions: [{ kind: 'record_exists', selector: { collection: 'orders', where: [] } }],
    });
    expect(result.success).toBe(false);
  });

  it('defaults record assertions to the final state', () => {
    const parsed = ContractRequirementSchema.parse({
      ...requirement,
      assertions: [
        {
          kind: 'record_exists',
          selector: { collection: 'orders', where: [{ field: 'id', equals: 'ORD-1' }] },
        },
      ],
    });
    const assertion = parsed.assertions[0];
    expect(assertion?.kind === 'record_exists' && assertion.state).toBe('final');
  });
});

describe('EvaluationRunManifestSchema', () => {
  const manifest = {
    schemaVersion: '1.0.0',
    runId: 'RUN-1',
    createdAt: '2025-03-04T09:00:00.000Z',
    system: 'stateproof',
    stage: 'foundation-smoke',
    mode: 'replay',
    gitCommitSha: null,
    runtimeVersion: 'node-20.10.0',
    packageLockHash: null,
    datasetName: 'phantombench-12',
    agentVisibleDatasetHash: 'a'.repeat(64),
    datasetHash: null,
    splits: ['development'],
    caseIds: ['PB-A03'],
    modelProvider: null,
    modelId: null,
    modelConfiguration: { temperature: 0, maxTokens: 4096 },
    maxRetries: 1,
    timeoutPolicy: '60s per model call',
    promptFilePaths: [],
    promptHashes: {},
    startedAt: '2025-03-04T09:00:00.000Z',
    finishedAt: '2025-03-04T09:01:00.000Z',
    wallClockMs: 60000,
    modelUsage: null,
    rawResponsePaths: [],
    trajectoryPaths: [],
    predictionPath: null,
    reportPath: null,
    notes: [],
  };

  it('accepts a replay manifest with unavailable model metadata recorded as null', () => {
    expect(EvaluationRunManifestSchema.parse(manifest).runId).toBe('RUN-1');
  });

  it('rejects a dataset hash that is not a sha256 digest', () => {
    const result = EvaluationRunManifestSchema.safeParse({ ...manifest, datasetHash: 'nope' });
    expect(result.success).toBe(false);
  });

  it('accepts a gold-inclusive dataset hash once scoring has filled it in', () => {
    const completed = EvaluationRunManifestSchema.parse({
      ...manifest,
      datasetHash: 'b'.repeat(64),
      reportPath: 'reports/RUN-1.md',
    });
    expect(completed.datasetHash).not.toBe(completed.agentVisibleDatasetHash);
  });

  it('requires the agent-visible fingerprint, which the prediction phase writes', () => {
    const { agentVisibleDatasetHash: _omitted, ...withoutFingerprint } = manifest;
    expect(EvaluationRunManifestSchema.safeParse(withoutFingerprint).success).toBe(false);
  });

  it('rejects an unknown field so manifests cannot drift silently', () => {
    const result = EvaluationRunManifestSchema.safeParse({ ...manifest, bva: 0.99 });
    expect(result.success).toBe(false);
  });
});

describe('CaseResultSchema', () => {
  const caseResult = {
    schemaVersion: '1.0.0',
    runId: 'RUN-1',
    caseId: 'PB-A03',
    goldVerdict: 'FAIL',
    predictedVerdict: 'FAIL',
    correct: true,
    unsafeFalseCompletion: false,
    parseAttempts: 1,
    runtimeMs: 12,
    modelUsage: null,
    summary: 'Approval followed the refund.',
    requirementVerdicts: [],
    goldRequirementExpectations: [{ requirementId: 'A-PROC-01', expectedStatus: 'disproven' }],
    evidenceIds: [],
    artifactPaths: [],
  };

  it('accepts a scored case result, the one artifact allowed to hold gold fields', () => {
    expect(CaseResultSchema.parse(caseResult).caseId).toBe('PB-A03');
  });

  it('rejects a case id that is not in the canonical format', () => {
    expect(CaseResultSchema.safeParse({ ...caseResult, caseId: 'PB-1' }).success).toBe(false);
  });
});
