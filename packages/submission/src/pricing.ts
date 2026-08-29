/**
 * API cost estimation from a pinned pricing snapshot.
 *
 * This is an *estimate against published list prices on a stated date*, not an
 * invoice. It is computed from the input and output token counts each run
 * recorded separately, because the two are priced differently — deriving cost
 * from a total-token figure would silently price output at the input rate and
 * understate the baseline by a factor of five on its output.
 *
 * No network call is made to obtain pricing, then or now.
 */

export interface PricingSnapshot {
  readonly modelId: string;
  /** ISO date the prices were read. Costs are only meaningful with it. */
  readonly asOf: string;
  readonly currency: 'USD';
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly formula: string;
  readonly sources: readonly string[];
  readonly excludes: readonly string[];
}

export const CLAUDE_OPUS_5_PRICING: PricingSnapshot = {
  modelId: 'claude-opus-5',
  asOf: '2026-08-29',
  currency: 'USD',
  inputUsdPerMillionTokens: 5,
  outputUsdPerMillionTokens: 25,
  formula: 'inputTokens * 5 / 1e6 + outputTokens * 25 / 1e6',
  sources: ['Anthropic, "Pricing - Claude Platform Docs"', 'Anthropic, "Introducing Claude Opus 5"'],
  excludes: [
    'local compute and developer time',
    'hosting or storage of artifacts',
    'smoke tests and exploratory calls, reported separately as development overhead',
  ],
};

export interface TokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

/**
 * Returns null when either count is missing.
 *
 * A run that did not record its token split cannot be priced, and guessing one
 * half from the other would produce a number that looks measured and is not.
 */
export function estimateCostUsd(
  usage: TokenUsage,
  pricing: PricingSnapshot = CLAUDE_OPUS_5_PRICING,
): number | null {
  const { inputTokens, outputTokens } = usage;
  if (inputTokens === null || outputTokens === null) return null;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  if (inputTokens < 0 || outputTokens < 0) return null;
  return (
    (inputTokens * pricing.inputUsdPerMillionTokens) / 1_000_000 +
    (outputTokens * pricing.outputUsdPerMillionTokens) / 1_000_000
  );
}

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
