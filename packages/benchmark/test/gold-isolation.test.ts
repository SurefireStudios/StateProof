import { describe, expect, it } from 'vitest';
import { AgentVisibleCaseSchema, canonicalJson, toJsonValue } from '@stateproof/core';
import {
  AGENT_VISIBLE_FILES,
  GoldDataAccessError,
  HUMAN_ONLY_FILES,
  caseDirFor,
  createAgentInputReader,
  createGoldReader,
  loadAgentVisibleCase,
  loadGoldBundle,
} from '@stateproof/benchmark';

const caseDir = caseDirFor('PB-A03');

describe('agent input reader', () => {
  const reader = createAgentInputReader(caseDir);

  it('exposes exactly the six agent-visible files', () => {
    expect([...reader.readableFiles]).toEqual([...AGENT_VISIBLE_FILES]);
  });

  it.each([...HUMAN_ONLY_FILES])('refuses to read %s', (fileName) => {
    expect(() => reader.readText(fileName)).toThrow(GoldDataAccessError);
  });

  it('refuses any file outside the allow list, including future additions', () => {
    expect(() => reader.readText('notes.json')).toThrow(GoldDataAccessError);
  });

  it('refuses path traversal', () => {
    expect(() => reader.readText('../PB-A03/gold-verdict.json')).toThrow(GoldDataAccessError);
    expect(() => reader.readText('subdir/task.json')).toThrow(GoldDataAccessError);
  });

  it('still reads the agent-visible files', () => {
    expect(reader.readText('final-response.txt').length).toBeGreaterThan(0);
  });
});

describe('gold reader', () => {
  it('is the only path to gold data, and is never handed to an agent', () => {
    const gold = loadGoldBundle('PB-A03', createGoldReader(caseDir));
    expect(gold.goldVerdict.overall).toBe('FAIL');
    expect(gold.metadata.split).toBe('development');
  });
});

describe('loaded agent input carries no gold data', () => {
  const agentVisible = loadAgentVisibleCase('PB-A03');
  const serialized = canonicalJson(toJsonValue(agentVisible));

  it('has only agent-visible top-level keys', () => {
    expect(Object.keys(agentVisible).sort()).toEqual([
      'caseId',
      'finalResponse',
      'finalState',
      'initialState',
      'task',
      'toolRegistry',
      'trajectory',
    ]);
  });

  it.each([
    'goldLabel',
    'goldContract',
    'goldVerdict',
    'expectedStatus',
    'isolatedFailureRequirementId',
    'failureDescription',
    'requirementId',
    'A-PROC-01',
    'approval_after_protected_action',
    'mustPass',
    'NEEDS_REVIEW',
    'FAIL',
    'locked',
  ])('does not contain %s anywhere in its serialized form', (needle) => {
    expect(serialized).not.toContain(needle);
  });

  it('rejects any attempt to smuggle gold fields through the schema', () => {
    const result = AgentVisibleCaseSchema.safeParse({
      ...agentVisible,
      goldVerdict: { overall: 'FAIL' },
    });
    expect(result.success).toBe(false);
  });
});
