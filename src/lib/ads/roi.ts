/**
 * ROI/ROAS math — pure, same style as src/lib/ads/metrics.ts. Revenue
 * attribution is a DB query (won deals whose contact carries this
 * campaign's id, closed within the range); this module only does the
 * arithmetic once spend and revenue are known.
 */

export interface RoiInput {
  spend: number
  revenue: number
}

export interface RoiResult {
  /** (revenue - spend) / spend, as a fraction (0.5 = 50%). Null if spend is 0. */
  roi: number | null
  /** revenue / spend — "return per unit spent". Null if spend is 0. */
  roas: number | null
}

/**
 * ROI/ROAS for a campaign over a period. Both null when spend is 0 —
 * a campaign with revenue but no recorded spend (nothing synced yet,
 * or a manual campaign with no cost entered) should read as "not
 * enough data", not as an infinite return.
 */
export function computeRoi({ spend, revenue }: RoiInput): RoiResult {
  if (!Number.isFinite(spend) || spend <= 0 || !Number.isFinite(revenue)) {
    return { roi: null, roas: null }
  }
  return {
    roi: (revenue - spend) / spend,
    roas: revenue / spend,
  }
}

/**
 * Whether a campaign's ROI can be trusted as a number. Revenue is
 * always tallied in the account's own default currency (deal values
 * don't carry an ad-platform currency), so if the campaign's ad
 * account reports spend in a different currency, comparing the two
 * raw would silently mix currencies — there is no FX conversion in
 * this app (same one-currency-per-account stance as migration 021).
 * The caller shows a warning instead of a number when this is false.
 */
export function roiIsComparable(campaignCurrency: string, accountCurrency: string): boolean {
  return campaignCurrency === accountCurrency
}
