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

// The sync walks ad accounts one after another, so a single hung request
// stalls every remaining account in a cron run. Same reasoning as the
// bounded fetch in the automations engine's send_webhook step.
const REQUEST_TIMEOUT_MS = 20_000

// Safety net on cursor following, in case a paging cursor ever loops.
// 20 pages x 500 rows is far past any real ad account here.
const MAX_PAGES = 20

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
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    // A timeout arrives as a TimeoutError whose message says nothing
    // about Meta. The operator reads this string in Settings as
    // `ad_accounts.last_error`, so name the actual cause.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`${fallback}: Meta did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`)
    }
    throw err
  }
  if (!response.ok) await throwMetaError(response, fallback)
  return (await response.json()) as T
}

interface MetaPage<T> {
  data?: T[]
  paging?: { next?: string }
}

/**
 * Follow Meta's cursor pagination and return every row.
 *
 * `limit` is a page size, not a total — the first version of this client
 * set it to 500 and read only the first page, which truncated silently.
 * For insights that is worse than an outright error: they come per
 * campaign *per day*, so a 4-day window overflows 500 rows at ~125
 * campaigns, and the rows we drop read as **less spend** — which inflates
 * ROI with nothing on screen to hint the numbers are partial.
 */
async function metaGetAllPages<T>(
  firstUrl: string,
  accessToken: string,
  fallback: string,
): Promise<T[]> {
  const all: T[] = []
  let url: string | undefined = firstUrl

  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const body: MetaPage<T> = await metaGet<MetaPage<T>>(url, accessToken, fallback)
    all.push(...(body.data ?? []))
    // `paging.next` is an absolute URL that already carries the cursor
    // plus the original fields and params.
    url = body.paging?.next
  }

  return all
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
  return metaGetAllPages<MetaCampaign>(url, accessToken, 'Failed to list campaigns')
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
  return metaGetAllPages<MetaCampaignInsight>(
    url,
    accessToken,
    'Failed to fetch campaign insights',
  )
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
 * connection" button. Returns the ad account's own name, currency and
 * timezone.
 *
 * Currency seeds `ad_accounts.currency` and gates whether ROI can be
 * shown as a number at all (no FX in this app). Timezone seeds
 * `ad_accounts.timezone`: Meta reports insight dates in *this* zone
 * while the operator reads the page in the browser's, so when they
 * differ a day's spend can look shifted for no visible reason. Storing
 * it lets Settings say so instead of leaving it a mystery.
 */
export async function verifyAdAccount(args: {
  adAccountId: string
  accessToken: string
}): Promise<{ name: string; currency: string; timezone: string | null }> {
  const { adAccountId, accessToken } = args
  const params = new URLSearchParams({ fields: 'name,currency,timezone_name' })
  const url = `${GRAPH_API_BASE}/${adAccountId}?${params}`
  const data = await metaGet<{
    name: string
    currency: string
    timezone_name?: string
  }>(url, accessToken, 'Failed to verify ad account')

  return {
    name: data.name,
    currency: data.currency,
    timezone: data.timezone_name ?? null,
  }
}
