import { describe, expect, it } from 'vitest';
import {
  CLAUDE_OPUS_5_PRICING,
  PRICING_TABLE,
  PRICING_TABLE_VERSION,
  estimateCostUsd,
  priceRun,
  pricingFor,
} from '../src/pricing';

/**
 * The point of these is not arithmetic. It is that a cost figure is never invented:
 * an unpriced model, a missing token count and a partial usage record must all come
 * back as "not priced" rather than as a number that looks measured.
 */

describe('pricingFor', () => {

  it('finds a model the table prices', () => {
    expect(pricingFor('claude-opus-5')).toBe(CLAUDE_OPUS_5_PRICING);
  });

  it('returns null for a model the table does not price', () => {
    expect(pricingFor('some-other-model')).toBeNull();
    expect(pricingFor(null)).toBeNull();
  });

  it('keys every entry by its own model id, so a lookup cannot return the wrong rates', () => {
    for (const [key, snapshot] of Object.entries(PRICING_TABLE)) {
      expect(snapshot.modelId, key).toBe(key);
    }
  });
});

describe('estimateCostUsd', () => {

  it('prices input and output separately', () => {
    // 1M input at $5 plus 1M output at $25. Pricing both at the input rate would
    // give $10, which is the mistake this split exists to prevent.
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      CLAUDE_OPUS_5_PRICING,
    );

    expect(cost).toBeCloseTo(30, 10);
  });

  it('is null when either token count is missing', () => {
    expect(estimateCostUsd({ inputTokens: null, outputTokens: 10 })).toBeNull();
    expect(estimateCostUsd({ inputTokens: 10, outputTokens: null })).toBeNull();
  });

  it('is null for counts that are not usable numbers', () => {
    expect(estimateCostUsd({ inputTokens: Number.NaN, outputTokens: 10 })).toBeNull();
    expect(estimateCostUsd({ inputTokens: -1, outputTokens: 10 })).toBeNull();
  });
});

describe('priceRun', () => {

  it('returns a cost and the table version that produced it', () => {
    const priced = priceRun({ inputTokens: 1_000_000, outputTokens: 0 }, 'claude-opus-5');

    expect(priced.estimatedCostUsd).toBeCloseTo(5, 10);
    expect(priced.pricingTableVersion).toBe(PRICING_TABLE_VERSION);
  });

  it('leaves an unpriced model unpriced rather than borrowing other rates', () => {
    const priced = priceRun({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'some-other-model');

    expect(priced.estimatedCostUsd).toBeNull();
    expect(priced.pricingTableVersion).toBeNull();
  });

  it('records no table version when the tokens could not be priced', () => {
    // A version without a figure would imply this run was priced when it was not.
    const priced = priceRun({ inputTokens: null, outputTokens: 5 }, 'claude-opus-5');

    expect(priced.estimatedCostUsd).toBeNull();
    expect(priced.pricingTableVersion).toBeNull();
  });

  it('prices a zero-token run as zero rather than as unpriced', () => {
    const priced = priceRun({ inputTokens: 0, outputTokens: 0 }, 'claude-opus-5');

    expect(priced.estimatedCostUsd).toBe(0);
    expect(priced.pricingTableVersion).toBe(PRICING_TABLE_VERSION);
  });
});
