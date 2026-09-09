/**
 * Cost presentation and the submission's own baseline-versus-StateProof comparison.
 *
 * The rate table and the per-run estimate live in `@stateproof/core`, beside the
 * manifest fields they fill. This file re-exports them so existing importers are
 * unchanged, and there is one table rather than two that can disagree.
 */

import {
  CLAUDE_OPUS_5_PRICING,
  type PricingSnapshot,
  type TokenUsage,
  estimateCostUsd,
} from '@stateproof/core';

export {
  CLAUDE_OPUS_5_PRICING,
  PRICING_TABLE,
  PRICING_TABLE_VERSION,
  estimateCostUsd,
  priceRun,
  pricingFor,
} from '@stateproof/core';
export type { PricingSnapshot, TokenUsage } from '@stateproof/core';

/** Cents-level precision is the most this estimate can honestly carry. */
export function formatUsd(value: number | null): string {
  if (value === null) return 'not priced';
  if (value === 0) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export interface CostComparison {
  readonly baselineUsd: number | null;
  readonly firstDeploymentUsd: number | null;
  readonly repeatedUsd: number | null;
  readonly absoluteSavingsUsd: number | null;
  readonly percentSavings: number | null;
  /** Suite runs before compiling once is cheaper, in dollars rather than tokens. */
  readonly breakEvenRuns: number | null;
}

export function compareCosts(
  baseline: TokenUsage,
  firstDeployment: TokenUsage,
  repeated: TokenUsage,
  pricing: PricingSnapshot = CLAUDE_OPUS_5_PRICING,
): CostComparison {
  const baselineUsd = estimateCostUsd(baseline, pricing);
  const firstDeploymentUsd = estimateCostUsd(firstDeployment, pricing);
  const repeatedUsd = estimateCostUsd(repeated, pricing);

  const absoluteSavingsUsd =
    baselineUsd === null || firstDeploymentUsd === null ? null : baselineUsd - firstDeploymentUsd;
  const percentSavings =
    baselineUsd === null || firstDeploymentUsd === null || baselineUsd === 0
      ? null
      : (baselineUsd - firstDeploymentUsd) / baselineUsd;

  const breakEvenRuns =
    baselineUsd === null ||
    firstDeploymentUsd === null ||
    repeatedUsd === null ||
    baselineUsd <= repeatedUsd
      ? null
      : Math.max(
          1,
          Math.ceil((firstDeploymentUsd - repeatedUsd) / (baselineUsd - repeatedUsd)),
        );

  return {
    baselineUsd,
    firstDeploymentUsd,
    repeatedUsd,
    absoluteSavingsUsd,
    percentSavings,
    breakEvenRuns,
  };
}
