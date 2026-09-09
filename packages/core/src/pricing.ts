/**
 * API cost estimation from a pinned rate table.
 *
 * This is an *estimate against published list prices on a stated date*, not an
 * invoice. It is computed from the input and output token counts each run records
 * separately, because the two are priced differently — deriving cost from a total
 * would silently price output at the input rate.
 *
 * It lives in core beside the manifest schema whose `estimatedCostUsd` and
 * `pricingTableVersion` fields it fills, so the fields and the only code that
 * populates them cannot drift apart. No network call is made to obtain pricing.
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

/**
 * The rate table, versioned as a whole.
 *
 * A cost figure is only meaningful with the rates that produced it, so runs record
 * this version rather than the number alone: a rate change later must not silently
 * restate what an earlier run cost. Bump the version whenever any entry changes,
 * and keep the old entry rather than editing it in place.
 */
export const PRICING_TABLE_VERSION = '2026-08-29.1';

/** Keyed by the model id a run manifest records, so a lookup needs nothing else. */
export const PRICING_TABLE: Readonly<Record<string, PricingSnapshot>> = {
  [CLAUDE_OPUS_5_PRICING.modelId]: CLAUDE_OPUS_5_PRICING,
};

/**
 * Returns null for a model the table does not price.
 *
 * An unpriced model is reported as unpriced. Falling back to another model's rates
 * would produce a number that looks measured and is not, which is the failure this
 * whole file is written to avoid.
 */
export function pricingFor(modelId: string | null): PricingSnapshot | null {
  if (modelId === null) return null;
  return PRICING_TABLE[modelId] ?? null;
}

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

/**
 * The two manifest fields that describe what a run cost, derived together.
 *
 * They are returned as a pair because they have to agree: a figure without the rate
 * table that produced it cannot be checked later, and a table version without a
 * figure says nothing. A model the table does not price yields null for both, which
 * is the honest answer — pricing it at another model's rates would produce a number
 * that looks measured and is not.
 */
export function priceRun(
  usage: TokenUsage,
  modelId: string | null,
): { estimatedCostUsd: number | null; pricingTableVersion: string | null } {
  const pricing = pricingFor(modelId);
  if (pricing === null) return { estimatedCostUsd: null, pricingTableVersion: null };
  const estimatedCostUsd = estimateCostUsd(usage, pricing);
  return {
    estimatedCostUsd,
    pricingTableVersion: estimatedCostUsd === null ? null : PRICING_TABLE_VERSION,
  };
}
