/**
 * Ads sync — pulls campaigns + daily spend from Meta and resolves the
 * ad ids captured by the WhatsApp webhook (migration 037) into the
 * campaign that paid for them.
 *
 * Three passes per `ad_accounts` row, in this order:
 *
 *   1. Campaigns  — upsert every ACTIVE/PAUSED campaign. Runs first
 *      because pass 3 needs a campaign row to attach a resolved ad to.
 *   2. Insights    — upsert daily spend/impressions/clicks for a
 *      trailing window. Re-covers the last few days on every run (not
 *      just "since last sync") because Meta revises a day's numbers
 *      for a short window after it ends; re-fetching is how those
 *      revisions reach us.
 *   3. Ad resolution — for every ad id on a contact that has no
 *      campaign yet, ask Meta what campaign it belongs to and backfill
 *      `contacts` and `attribution_events`. Capped per run: this is one
 *      Graph API call per ad, and a spike of new ads (a fresh campaign
 *      launch) should not turn one sync run into an unbounded loop
 *      against Meta's rate limits. Which ads are due — including how
 *      failures are retried and eventually abandoned — is decided by
 *      resolution-policy.ts.
 *
 * Idempotent throughout — `ad_campaigns` and `ad_metrics_daily` upsert
 * on their unique keys, so re-running for the same window overwrites
 * rather than duplicates.
 *
 * On clocks: no day is ever computed from the server's local time here.
 * See src/lib/ads/day-key.ts for the three timezones involved and which
 * one owns what.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { utcDayKey, utcDayKeyDaysAgo } from './day-key'
import { selectAdsToResolve } from './resolution-policy'
import {
  extractMessagingStarted,
  fetchCampaignInsights,
  listCampaigns,
  resolveAd,
} from './meta'

// One Graph API call per unresolved ad per run. Bounds worst-case sync
// duration and Meta rate-limit exposure; the rest resolve on the next run.
const MAX_AD_RESOLUTIONS_PER_RUN = 25

// How many trailing days of insights to re-fetch on every run, to catch
// Meta's post-close-of-day revisions to recent spend. Four rather than
// three so the window still covers the edge day when the ad account's
// timezone and UTC disagree about which day it is.
const INSIGHTS_WINDOW_DAYS = 4

export interface SyncResult {
  adAccountId: string
  campaignsSynced: number
  metricsDaysSynced: number
  adsResolved: number
  adsFailed: number
  error: string | null
}

interface AdAccountRow {
  id: string
  account_id: string
  platform: string
  external_id: string
  access_token_encrypted: string | null
  currency: string
}

/**
 * Sync every connected Meta ad account for one CRM account, or every
 * account when `accountId` is omitted (the cron path). Errors on one
 * ad account never abort the others — each result carries its own
 * `error`, and the caller (the API route) decides how to report a
 * partial failure.
 */
export async function syncAllAdAccounts(
  db: SupabaseClient,
  accountId?: string,
): Promise<SyncResult[]> {
  let query = db
    .from('ad_accounts')
    .select('id, account_id, platform, external_id, access_token_encrypted, currency')
    .eq('platform', 'meta')
    .eq('status', 'connected')

  if (accountId) query = query.eq('account_id', accountId)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list ad accounts: ${error.message}`)

  const rows = (data ?? []) as AdAccountRow[]
  const results: SyncResult[] = []
  for (const row of rows) {
    results.push(await syncOneAdAccount(db, row))
  }
  return results
}

async function syncOneAdAccount(
  db: SupabaseClient,
  row: AdAccountRow,
): Promise<SyncResult> {
  const result: SyncResult = {
    adAccountId: row.id,
    campaignsSynced: 0,
    metricsDaysSynced: 0,
    adsResolved: 0,
    adsFailed: 0,
    error: null,
  }

  if (!row.access_token_encrypted) {
    result.error = 'No access token stored for this ad account'
    return result
  }

  let accessToken: string
  try {
    accessToken = decrypt(row.access_token_encrypted)
  } catch {
    result.error = 'Stored access token could not be decrypted'
    return result
  }

  try {
    result.campaignsSynced = await syncCampaigns(db, row, accessToken)
    result.metricsDaysSynced = await syncInsights(db, row, accessToken)
    const { resolved, failed } = await resolveUnresolvedAds(db, row, accessToken)
    result.adsResolved = resolved
    result.adsFailed = failed

    await db
      .from('ad_accounts')
      .update({ last_synced_at: new Date().toISOString(), last_error: null, status: 'connected' })
      .eq('id', row.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown sync error'
    result.error = message
    await db
      .from('ad_accounts')
      .update({ last_error: message, status: 'error' })
      .eq('id', row.id)
  }

  return result
}

/** Map of Meta campaign id -> our ad_campaigns.id, after upserting. */
async function syncCampaigns(
  db: SupabaseClient,
  row: AdAccountRow,
  accessToken: string,
): Promise<number> {
  const campaigns = await listCampaigns({ adAccountId: row.external_id, accessToken })
  if (campaigns.length === 0) return 0

  const now = new Date().toISOString()
  // One batched upsert rather than one per campaign: this used to be a
  // round trip per row, so an account with 50 campaigns paid 50
  // sequential waits before the insights pass even started.
  const { error } = await db.from('ad_campaigns').upsert(
    campaigns.map((c) => ({
      account_id: row.account_id,
      ad_account_id: row.id,
      external_id: c.id,
      name: c.name,
      objective: c.objective,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      currency: row.currency,
      is_manual: false,
      updated_at: now,
    })),
    { onConflict: 'ad_account_id,external_id' },
  )
  if (error) {
    throw new Error(`Failed to upsert campaigns: ${error.message}`)
  }

  return campaigns.length
}

async function syncInsights(
  db: SupabaseClient,
  row: AdAccountRow,
  accessToken: string,
): Promise<number> {
  // UTC, not the server's local day: this runs on a UTC host in
  // production and on a laptop in development, and an ambiguous window
  // is how edge days go missing. The dates we *store* come from Meta's
  // own `date_start` (the ad account's timezone) — this only bounds what
  // we ask for, which is why a slightly generous window is the right
  // call rather than a precise one.
  const until = utcDayKey(new Date())
  const since = utcDayKeyDaysAgo(INSIGHTS_WINDOW_DAYS - 1)

  const insights = await fetchCampaignInsights({
    adAccountId: row.external_id,
    accessToken,
    since,
    until,
  })
  if (insights.length === 0) return 0

  // Insights reference campaigns by Meta's external_id; ad_metrics_daily
  // needs our internal ad_campaigns.id (the FK), so resolve the map once
  // rather than a query per row.
  const { data: campaignRows, error: campaignsError } = await db
    .from('ad_campaigns')
    .select('id, external_id')
    .eq('ad_account_id', row.id)
  if (campaignsError) {
    throw new Error(`Failed to load campaigns for metrics: ${campaignsError.message}`)
  }
  const campaignIdByExternal = new Map(
    ((campaignRows ?? []) as { id: string; external_id: string }[]).map((c) => [
      c.external_id,
      c.id,
    ]),
  )

  const now = new Date().toISOString()
  const rows = []
  for (const insight of insights) {
    const campaignId = campaignIdByExternal.get(insight.campaign_id)
    if (!campaignId) {
      // Insight for a campaign our campaigns pass didn't see this run
      // (e.g. it just went ARCHIVED). Skip rather than fail the whole
      // sync — it'll pick up once the campaign reappears as
      // ACTIVE/PAUSED, or never matters again if it's truly retired.
      continue
    }

    rows.push({
      account_id: row.account_id,
      campaign_id: campaignId,
      // Meta's own day, in the ad account's timezone. Never computed
      // here — see the window comment above.
      date: insight.date_start,
      spend: Number(insight.spend) || 0,
      impressions: Number(insight.impressions) || 0,
      clicks: Number(insight.clicks) || 0,
      messaging_started: extractMessagingStarted(insight.actions),
      currency: row.currency,
      origin: 'api',
      raw: insight,
      updated_at: now,
    })
  }

  if (rows.length === 0) return 0

  // Batched for the same reason as the campaigns pass: insights are per
  // campaign *per day*, so a row-at-a-time loop was the single biggest
  // source of round trips in the whole sync.
  const { error } = await db
    .from('ad_metrics_daily')
    .upsert(rows, { onConflict: 'campaign_id,date' })
  if (error) {
    throw new Error(`Failed to upsert daily metrics: ${error.message}`)
  }

  return rows.length
}

async function resolveUnresolvedAds(
  db: SupabaseClient,
  row: AdAccountRow,
  accessToken: string,
): Promise<{ resolved: number; failed: number }> {
  // Ad ids the webhook has seen but never resolved to a campaign,
  // scoped to this account. Sourced from contacts.source_ad_id
  // (migration 037) rather than attribution_events, since that's what
  // ultimately needs source_campaign_id filled in for reporting.
  const { data: unresolvedContacts, error: contactsError } = await db
    .from('contacts')
    .select('source_ad_id')
    .eq('account_id', row.account_id)
    .not('source_ad_id', 'is', null)
    .is('source_campaign_id', null)
    .limit(500)
  if (contactsError) {
    throw new Error(`Failed to list unresolved ads: ${contactsError.message}`)
  }

  const adIds = Array.from(
    new Set(
      ((unresolvedContacts ?? []) as { source_ad_id: string }[]).map((c) => c.source_ad_id),
    ),
  )
  if (adIds.length === 0) return { resolved: 0, failed: 0 }

  // What we already know about these ads. Crucially this is *not* a
  // "have we seen it before" check any more: a row exists after a
  // failure too, and treating that as final made every transient error
  // permanent. selectAdsToResolve decides using attempts + backoff.
  const { data: seenRows } = await db
    .from('ad_entities')
    .select('ad_id, campaign_id, attempts, last_attempt_at')
    .eq('account_id', row.account_id)
    .in('ad_id', adIds)

  const seenByAdId = new Map(
    (
      (seenRows ?? []) as {
        ad_id: string
        campaign_id: string | null
        attempts: number | null
        last_attempt_at: string | null
      }[]
    ).map((r) => [r.ad_id, r]),
  )

  const now = new Date()
  const toResolve = selectAdsToResolve({
    candidates: adIds.map((adId) => {
      const seen = seenByAdId.get(adId)
      return {
        adId,
        campaignId: seen?.campaign_id ?? null,
        attempts: seen?.attempts ?? 0,
        lastAttemptAt: seen?.last_attempt_at ? new Date(seen.last_attempt_at) : null,
      }
    }),
    now,
    max: MAX_AD_RESOLUTIONS_PER_RUN,
  })

  let resolved = 0
  let failed = 0

  for (const adId of toResolve) {
    const attemptsSoFar = seenByAdId.get(adId)?.attempts ?? 0
    // Counted before the call, so a thrown error still records the try —
    // otherwise a consistently failing ad would retry forever.
    const attempts = attemptsSoFar + 1
    const attemptedAt = new Date().toISOString()

    try {
      const info = await resolveAd({ adId, accessToken })

      let campaignRowId: string | null = null
      if (info.campaignId) {
        const { data: campaignRow } = await db
          .from('ad_campaigns')
          .select('id')
          .eq('ad_account_id', row.id)
          .eq('external_id', info.campaignId)
          .maybeSingle()
        campaignRowId = (campaignRow as { id: string } | null)?.id ?? null
      }

      await db.from('ad_entities').upsert(
        {
          account_id: row.account_id,
          ad_account_id: row.id,
          ad_id: adId,
          ad_name: info.adName,
          adset_id: info.adsetId,
          adset_name: info.adsetName,
          campaign_id: campaignRowId,
          last_error: campaignRowId ? null : 'Ad resolved but its campaign is not synced yet',
          attempts,
          last_attempt_at: attemptedAt,
          // Only a real resolution stamps this; `last_attempt_at` is
          // what "we tried" means now.
          resolved_at: campaignRowId ? attemptedAt : null,
        },
        { onConflict: 'account_id,ad_id' },
      )

      if (campaignRowId) {
        // Both tables: contacts is what the /campaigns reports read, and
        // attribution_events is the append-only log that migration 037's
        // idx_attribution_events_unresolved exists to scan.
        await db
          .from('contacts')
          .update({ source_campaign_id: info.campaignId })
          .eq('account_id', row.account_id)
          .eq('source_ad_id', adId)
        await db
          .from('attribution_events')
          .update({ campaign_id: info.campaignId })
          .eq('account_id', row.account_id)
          .eq('ad_id', adId)
          .is('campaign_id', null)
        resolved += 1
      } else {
        failed += 1
      }
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : 'Unknown error resolving ad'
      await db.from('ad_entities').upsert(
        {
          account_id: row.account_id,
          ad_account_id: row.id,
          ad_id: adId,
          last_error: message,
          attempts,
          last_attempt_at: attemptedAt,
        },
        { onConflict: 'account_id,ad_id' },
      )
    }
  }

  return { resolved, failed }
}
