/**
 * Client-side loader for the /campaigns page — same pattern as
 * src/lib/dashboard/queries.ts: RLS scopes every query to the
 * signed-in account, so nothing here passes account_id explicitly.
 *
 * Three queries, joined in JS rather than via a PostgREST embed
 * (`ad_campaigns(ad_accounts(...))`) — an embed asks PostgREST to
 * resolve the FK relationship from its schema cache, which can be
 * stale right after a migration that *adds* the FK (see the same
 * tradeoff, and the PGRST200 failure it avoids, documented in
 * getCurrentAccount() in src/lib/auth/account.ts). Migration 038 is
 * new enough that this is exactly the situation to avoid.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from '@/lib/dashboard/date-utils'
import { costPerUnit, sumDailyMetrics, type DailyMetricRow } from './metrics'

type DB = SupabaseClient

export interface CampaignRow {
  id: string
  name: string
  platform: 'meta' | 'google' | 'other'
  effectiveStatus: string | null
  currency: string
  isManual: boolean
  spend: number
  impressions: number
  clicks: number
  /** Meta's own count; null when the platform doesn't report it. */
  messagingStarted: number | null
  /** Contacts the CRM attributes to this campaign, created in range. */
  leads: number
  costPerLead: number | null
}

export interface CampaignsResult {
  campaigns: CampaignRow[]
  /** Whether any ad account is connected at all — distinct from an
   *  empty `campaigns` list, which the page needs to tell "connect an
   *  account" from "no campaigns matched this range" apart. */
  hasAdAccounts: boolean
}

export async function loadCampaigns(
  db: DB,
  range: { since: Date; until: Date },
): Promise<CampaignsResult> {
  const sinceKey = localDayKey(range.since)
  const untilKey = localDayKey(range.until)

  const { data: adAccountRows, error: adAccountsError } = await db
    .from('ad_accounts')
    .select('id, platform')
  if (adAccountsError) {
    throw new Error(`Failed to load ad accounts: ${adAccountsError.message}`)
  }
  const platformByAdAccount = new Map(
    ((adAccountRows ?? []) as { id: string; platform: CampaignRow['platform'] }[]).map((a) => [
      a.id,
      a.platform,
    ]),
  )
  const hasAdAccounts = platformByAdAccount.size > 0

  const { data: campaignRows, error: campaignsError } = await db
    .from('ad_campaigns')
    .select('id, ad_account_id, external_id, name, effective_status, currency, is_manual')
    .order('name')
  if (campaignsError) {
    throw new Error(`Failed to load campaigns: ${campaignsError.message}`)
  }
  if (!campaignRows || campaignRows.length === 0) {
    return { campaigns: [], hasAdAccounts }
  }

  const campaignIds = campaignRows.map((c) => c.id as string)
  const externalIds = campaignRows.map((c) => c.external_id as string)

  const [{ data: metricsRows, error: metricsError }, { data: contactRows, error: contactsError }] =
    await Promise.all([
      db
        .from('ad_metrics_daily')
        .select('campaign_id, date, spend, impressions, clicks, messaging_started')
        .in('campaign_id', campaignIds)
        .gte('date', sinceKey)
        .lte('date', untilKey),
      // Leads: contacts the webhook/ads-sync attributed to this
      // campaign (by Meta's external campaign id — see migration 037),
      // created within the same range as the spend we're comparing it to.
      db
        .from('contacts')
        .select('source_campaign_id')
        .in('source_campaign_id', externalIds)
        .gte('created_at', range.since.toISOString())
        .lte('created_at', range.until.toISOString()),
    ])
  if (metricsError) throw new Error(`Failed to load campaign metrics: ${metricsError.message}`)
  if (contactsError) throw new Error(`Failed to load campaign leads: ${contactsError.message}`)

  const metricsByCampaign = new Map<string, DailyMetricRow[]>()
  for (const row of (metricsRows ?? []) as {
    campaign_id: string
    date: string
    spend: number
    impressions: number
    clicks: number
    messaging_started: number | null
  }[]) {
    const list = metricsByCampaign.get(row.campaign_id) ?? []
    list.push({
      date: row.date,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      messagingStarted: row.messaging_started,
    })
    metricsByCampaign.set(row.campaign_id, list)
  }

  const leadsByExternalId = new Map<string, number>()
  for (const row of (contactRows ?? []) as { source_campaign_id: string }[]) {
    leadsByExternalId.set(
      row.source_campaign_id,
      (leadsByExternalId.get(row.source_campaign_id) ?? 0) + 1,
    )
  }

  const campaigns: CampaignRow[] = campaignRows.map((c) => {
    const agg = sumDailyMetrics(metricsByCampaign.get(c.id as string) ?? [])
    const leads = leadsByExternalId.get(c.external_id as string) ?? 0
    return {
      id: c.id as string,
      name: c.name as string,
      platform: platformByAdAccount.get(c.ad_account_id as string) ?? 'other',
      effectiveStatus: c.effective_status as string | null,
      currency: c.currency as string,
      isManual: c.is_manual as boolean,
      spend: agg.spend,
      impressions: agg.impressions,
      clicks: agg.clicks,
      messagingStarted: agg.messagingStarted,
      leads,
      costPerLead: costPerUnit(agg.spend, leads),
    }
  })

  return { campaigns, hasAdAccounts }
}
