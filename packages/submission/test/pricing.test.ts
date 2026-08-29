import { describe, expect, it } from 'vitest';
import {
  CLAUDE_OPUS_5_PRICING,
  compareCosts,
  estimateCostUsd,
  formatUsd,
} from '@stateproof/submission';

/**
 * Cost is the one number in this project that cannot be re-derived from a run
 * artifact alone — it needs an external price. So the price is pinned with a
 * date and a source, and the arithmetic is tested rather than trusted.
 */

describe('the pricing snapshot', () => {
  it('is dated, sourced and per-direction', () => {
    expect(CLAUDE_OPUS_5_PRICING.asOf).toBe('2026-08-29');
    expect(CLAUDE_OPUS_5_PRICING.modelId).toBe('claude-opus-5');
    expect(CLAUDE_OPUS_5_PRICING.inputUsdPerMillionTokens).toBe(5);
    expect(CLAUDE_OPUS_5_PRICING.outputUsdPerMillionTokens).toBe(25);
    expect(CLAUDE_OPUS_5_PRICING.sources.length).toBeGreaterThan(0);
    expect(CLAUDE_OPUS_5_PRICING.excludes.join(' ')).toContain('local compute');
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output separately', () => {
    // One million of each: $5 + $25.
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30, 10);
  });

  it('never prices output at the input rate', () => {
    const split = estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000 });
    const flat = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 });
    expect(split).toBeCloseTo(25, 10);
    expect(flat).toBeCloseTo(5, 10);
    expect(split).not.toBeCloseTo(flat as number, 6);
  });

  it('prices the committed baseline and first-deployment token counts', () => {
    // Combined baseline: 110,934 in / 14,220 out.
    expect(estimateCostUsd({ inputTokens: 110_934, outputTokens: 14_220 })).toBeCloseTo(0.91017, 6);
    // StateProof first deployment: 24,245 in / 5,644 out.
    expect(estimateCostUsd({ inputTokens: 24_245, outputTokens: 5_644 })).toBeCloseTo(0.262325, 6);
  });

  it('is exactly zero for a run that made no model call', () => {
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('returns null when either count is missing rather than guessing', () => {
    expect(estimateCostUsd({ inputTokens: null, outputTokens: 100 })).toBeNull();
    expect(estimateCostUsd({ inputTokens: 100, outputTokens: null })).toBeNull();
    expect(estimateCostUsd({ inputTokens: null, outputTokens: null })).toBeNull();
    expect(formatUsd(null)).toBe('not priced');
  });

  it('refuses nonsense counts', () => {
    expect(estimateCostUsd({ inputTokens: -1, outputTokens: 0 })).toBeNull();
    expect(estimateCostUsd({ inputTokens: Number.NaN, outputTokens: 0 })).toBeNull();
  });
});

describe('compareCosts', () => {
  const baseline = { inputTokens: 110_934, outputTokens: 14_220 };
  const firstDeployment = { inputTokens: 24_245, outputTokens: 5_644 };
  const repeated = { inputTokens: 0, outputTokens: 0 };

  it('reports absolute and percentage savings from the priced counts', () => {
    const comparison = compareCosts(baseline, firstDeployment, repeated);
    expect(comparison.baselineUsd).toBeCloseTo(0.91017, 6);
    expect(comparison.firstDeploymentUsd).toBeCloseTo(0.262325, 6);
    expect(comparison.repeatedUsd).toBe(0);
    expect(comparison.absoluteSavingsUsd).toBeCloseTo(0.647845, 6);
    expect(comparison.percentSavings).toBeCloseTo(0.7118, 3);
  });

  it('breaks even on the first suite run', () => {
    expect(compareCosts(baseline, firstDeployment, repeated).breakEvenRuns).toBe(1);
  });

  it('withholds every figure when a count is missing', () => {
    const comparison = compareCosts(
      { inputTokens: null, outputTokens: null },
      firstDeployment,
      repeated,
    );
    expect(comparison.baselineUsd).toBeNull();
    expect(comparison.absoluteSavingsUsd).toBeNull();
    expect(comparison.percentSavings).toBeNull();
    expect(comparison.breakEvenRuns).toBeNull();
  });
});
