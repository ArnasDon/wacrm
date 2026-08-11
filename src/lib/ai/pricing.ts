/**
 * Provider pricing, in USD per 1 million tokens — checked against each
 * provider's published pricing in August 2026. Models are free text
 * throughout this app (see AI_PROVIDER_DEFAULT_MODEL's own comment), so
 * a custom or future model simply won't be in this table; callers must
 * treat that as "unknown cost", never guess a number.
 *
 * Prices are looked up by model at DISPLAY time, not stored per usage
 * row — cheap to keep current, but it means if a provider changes a
 * price, historical spend re-renders at the new price rather than the
 * price actually paid at the time. Fine for a cost-awareness tool; not
 * an accounting ledger.
 */
export interface ModelPricing {
  /** USD per 1,000,000 prompt/input tokens. */
  inputPerMillionUsd: number
  /** USD per 1,000,000 completion/output tokens. */
  outputPerMillionUsd: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5.4-mini': { inputPerMillionUsd: 0.75, outputPerMillionUsd: 4.5 },
  'claude-haiku-4-5-20251001': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
}

/** Seed default — an admin can override it per account (ai_configs.usd_to_mzn_rate)
 *  since forex moves; this is only the starting value for a new config. */
export const DEFAULT_USD_TO_MZN_RATE = 63.91

/** Null when the model isn't in the pricing table — never fabricate a cost. */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return null
  return (
    (promptTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (completionTokens / 1_000_000) * pricing.outputPerMillionUsd
  )
}
