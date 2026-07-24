/**
 * Meta Marketing API client — campaigns, daily spend, and resolving
 * an ad id (all we ever learn from a WhatsApp referral) to the
 * campaign that paid for it.
 *
 * Same calling convention as src/lib/whatsapp/meta-api.ts: named
 * parameters, one function per endpoint, throws with Meta's own
 * error message when the call fails.
 */

const GRAPH_API_VERSION = 'v25.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

async function metaGet<T>(url: string, accessToken: string, fallback: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) await throwMetaError(response, fallback)
  return (await response.json()) as T
}

export interface MetaCampaign {
  id: string
  name: string
  objective: string | null
  effective_status: string
  daily_budget: string | null
}

/**
 * List a campaign's active/paused campaigns. `adAccountId` is the
 * `act_<id>` form Meta uses everywhere in the Marketing API.
 */
export async function listCampaigns(args: {
  adAccountId: string
  accessToken: string
}): Promise<MetaCampaign[]> {
  const { adAccountId, accessToken } = args
  const params = new URLSearchParams({
    fields: 'name,objective,effective_status,daily_budget',
    // Meta wants this as a JSON-encoded array, not a repeated param.
    effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
    limit: '500',
  })

  const url = `${GRAPH_API_BASE}/${adAccountId}/campaigns?${params}`
  const data = await metaGet<{ data: MetaCampaign[] }>(
    url,
    accessToken,
    'Failed to list campaigns',
  )
  return data.data
}

export interface MetaCampaignInsight {
  campaign_id: string
  campaign_name: string
  spend: string
  impressions: string
  clicks: string
  date_start: string
  date_stop: string
  /** Present only when the campaign had at least one matching action. */
  actions?: Array<{ action_type: string; value: string }>
}

/**
 * Daily spend/impressions/clicks per campaign for a date range,
 * broken out by day so the result can be upserted straight into
 * `ad_metrics_daily` (one row per campaign per day).
 */
export async function fetchCampaignInsights(args: {
  adAccountId: string
  accessToken: string
  since: string // YYYY-MM-DD
  until: string // YYYY-MM-DD
}): Promise<MetaCampaignInsight[]> {
  const { adAccountId, accessToken, since, until } = args
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    limit: '500',
  })

  const url = `${GRAPH_API_BASE}/${adAccountId}/insights?${params}`
  const data = await metaGet<{ data: MetaCampaignInsight[] }>(
    url,
    accessToken,
    'Failed to fetch campaign insights',
  )
  return data.data
}

/** Pull the messaging-conversations-started count out of `actions`. */
export function extractMessagingStarted(
  actions: MetaCampaignInsight['actions'],
): number | null {
  if (!actions) return null
  const hit = actions.find((a) =>
    a.action_type.includes('messaging_conversation_started'),
  )
  return hit ? Math.round(Number(hit.value)) : null
}

export interface MetaAdResolution {
  adId: string
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
}

/**
 * Resolve a single ad id (the only thing the WhatsApp referral ever
 * gives us) to its adset and campaign. One call per unresolved ad —
 * Meta has no bulk "ad -> campaign" lookup, so the sync budgets a
 * capped number of these per run (see sync.ts).
 */
export async function resolveAd(args: {
  adId: string
  accessToken: string
}): Promise<MetaAdResolution> {
  const { adId, accessToken } = args
  const params = new URLSearchParams({
    fields: 'name,adset{id,name},campaign{id,name}',
  })
  const url = `${GRAPH_API_BASE}/${adId}?${params}`
  const data = await metaGet<{
    name?: string
    adset?: { id: string; name: string }
    campaign?: { id: string; name: string }
  }>(url, accessToken, 'Failed to resolve ad')

  return {
    adId,
    adName: data.name ?? null,
    adsetId: data.adset?.id ?? null,
    adsetName: data.adset?.name ?? null,
    campaignId: data.campaign?.id ?? null,
    campaignName: data.campaign?.name ?? null,
  }
}

/**
 * Verify a token/act_id pair actually works, for the Settings "Test
 * connection" button. Returns the ad account's own name + currency —
 * both useful to show back to the operator, and currency is what
 * `ad_accounts.currency` gets seeded from on connect.
 */
export async function verifyAdAccount(args: {
  adAccountId: string
  accessToken: string
}): Promise<{ name: string; currency: string }> {
  const { adAccountId, accessToken } = args
  const params = new URLSearchParams({ fields: 'name,currency' })
  const url = `${GRAPH_API_BASE}/${adAccountId}?${params}`
  const data = await metaGet<{ name: string; currency: string }>(
    url,
    accessToken,
    'Failed to verify ad account',
  )
  return data
}
