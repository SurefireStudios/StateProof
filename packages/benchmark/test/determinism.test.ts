import { describe, expect, it } from 'vitest';
import { canonicalJson, toJsonValue } from '@stateproof/core';
import {
  hashAgentVisibleCase,
  loadAgentVisibleCase,
  parseTrajectoryJsonl,
} from '@stateproof/benchmark';
import { datasetHash, loadAllCases, loadBenchmarkCase } from '@stateproof/benchmark/gold';

describe('deterministic loading', () => {
  it('produces an identical agent-visible hash on every load', () => {
    const first = hashAgentVisibleCase(loadAgentVisibleCase('PB-A03'));
    const second = hashAgentVisibleCase(loadAgentVisibleCase('PB-A03'));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serializes identically on every load', () => {
    const first = canonicalJson(toJsonValue(loadBenchmarkCase('PB-A03')));
    const second = canonicalJson(toJsonValue(loadBenchmarkCase('PB-A03')));
    expect(first).toBe(second);
  });

  it('survives a JSON round trip unchanged', () => {
    const loaded = toJsonValue(loadBenchmarkCase('PB-A03'));
    expect(canonicalJson(loaded)).toBe(canonicalJson(JSON.parse(JSON.stringify(loaded))));
  });

  it('produces a stable dataset hash', () => {
    expect(datasetHash(loadAllCases())).toBe(datasetHash(loadAllCases()));
  });
});

describe('trajectory parsing', () => {
  const line = (seq: number) =>
    JSON.stringify({
      eventId: `EV-${seq}`,
      seq,
      timestamp: `2025-03-04T09:0${seq}:00.000Z`,
      type: 'agent_message',
      role: 'assistant',
      content: 'hello',
    });

  it('ignores blank lines and tolerates CRLF endings', () => {
    const raw = `${line(1)}\r\n\r\n${line(2)}\n`;
    expect(parseTrajectoryJsonl(raw, 'PB-TEST')).toHaveLength(2);
  });

  it('reports the offending line number for malformed JSON', () => {
    expect(() => parseTrajectoryJsonl(`${line(1)}\n{oops}\n`, 'PB-TEST')).toThrow(/line 2/);
  });

  it('rejects a trajectory whose events are out of order', () => {
    expect(() => parseTrajectoryJsonl(`${line(2)}\n${line(1)}\n`, 'PB-TEST')).toThrow();
  });
});
