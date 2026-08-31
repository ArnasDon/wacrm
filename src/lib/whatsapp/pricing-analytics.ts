import { META_API_BASE } from './meta-api'

/**
 * Meta's WhatsApp per-message billing data (Graph API `pricing_analytics`
 * edge on the WABA node — replaced the older conversation-based pricing
 * model on 2025-07-01). Categories match what Meta actually bills:
 * MARKETING/UTILITY/AUTHENTICATION incur a per-message charge outside a
 * free customer-service window; SERVICE and the FREE_* pricing types are
 * unbilled. `cost` is a plain decimal in the WABA's own currency — Meta
 * does not echo a currency code on this edge, so callers pair it with
 * {@link getWabaCurrency}.
 */
export interface PricingDataPoint {
  start: number
  end: number
  pricingType: string
  pricingCategory: string
  volume: number
  cost: number
}

interface RawPricingAnalyticsResponse {
  data?: { data_points?: RawDataPoint[] }[]
}

interface RawDataPoint {
  start: number
  end: number
  pricing_type: string
  pricing_category: string
  volume: number
  cost: number
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as { error?: { message?: string } }
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface GetPricingAnalyticsArgs {
  wabaId: string
  accessToken: string
  /** Inclusive range, as Unix seconds. */
  startUnix: number
  endUnix: number
  granularity?: 'DAILY' | 'MONTHLY'
}

/**
 * Actual billed message volume + cost for a WABA, broken down by
 * pricing category and type. This is Meta's own accounting — not an
 * estimate derived from locally-stored message rows.
 */
export async function getPricingAnalytics(
  args: GetPricingAnalyticsArgs,
): Promise<PricingDataPoint[]> {
  const { wabaId, accessToken, startUnix, endUnix, granularity = 'DAILY' } = args

  const url = new URL(`${META_API_BASE}/${wabaId}/pricing_analytics`)
  url.searchParams.set('start', String(startUnix))
  url.searchParams.set('end', String(endUnix))
  url.searchParams.set('granularity', granularity)
  url.searchParams.set('metric_types', JSON.stringify(['COST', 'VOLUME']))
  url.searchParams.set('dimensions', JSON.stringify(['PRICING_CATEGORY', 'PRICING_TYPE']))

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta pricing_analytics error: ${response.status}`)
  }

  const json = (await response.json()) as RawPricingAnalyticsResponse
  const points = json.data?.flatMap((d) => d.data_points ?? []) ?? []

  return points.map((p) => ({
    start: p.start,
    end: p.end,
    pricingType: p.pricing_type,
    pricingCategory: p.pricing_category,
    volume: p.volume,
    cost: p.cost,
  }))
}

/**
 * The WABA's billing currency (ISO 4217, e.g. "INR", "USD") — set in
 * Meta Business Manager, not something the app controls or stores
 * locally. `pricing_analytics` cost figures are already denominated in
 * this currency; there is no per-request currency field to cross-check
 * it against.
 */
export async function getWabaCurrency(args: {
  wabaId: string
  accessToken: string
}): Promise<string | null> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}?fields=currency`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const json = (await response.json()) as { currency?: string }
  return json.currency ?? null
}
