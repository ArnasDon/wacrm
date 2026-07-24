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
import { computeRoi, roiIsComparable } from './roi'

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
  /** Value of won deals attributed to this campaign, closed in range. */
  revenue: number
  dealsWon: number
  roi: number | null
  roas: number | null
  /** False when the campaign's own currency differs from the account's
   *  default — there's no FX conversion, so ROI/ROAS would silently mix
   *  currencies if shown as a number. The page shows a warning instead. */
  roiComparable: boolean
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
  accountCurrency: string,
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

  const [
    { data: metricsRows, error: metricsError },
    { data: attributedContacts, error: contactsError },
  ] = await Promise.all([
    db
      .from('ad_metrics_daily')
      .select('campaign_id, date, spend, impressions, clicks, messaging_started')
      .in('campaign_id', campaignIds)
      .gte('date', sinceKey)
      .lte('date', untilKey),
    // Every contact ever attributed to one of these campaigns (by
    // Meta's external campaign id — migration 037), regardless of when
    // they were created. Needed both for "leads in range" below (an
    // in-JS date filter, since a lead created just outside the window
    // shouldn't count as this range's lead) and for revenue: a deal can
    // close months after the contact first arrived, so restricting this
    // query itself to the date range would silently drop revenue from
    // older leads that just happened to close now.
    db.from('contacts').select('id, source_campaign_id, created_at').in('source_campaign_id', externalIds),
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
  const externalIdByContactId = new Map<string, string>()
  for (const row of (attributedContacts ?? []) as {
    id: string
    source_campaign_id: string
    created_at: string
  }[]) {
    externalIdByContactId.set(row.id, row.source_campaign_id)
    const createdAt = new Date(row.created_at)
    if (createdAt >= range.since && createdAt <= range.until) {
      leadsByExternalId.set(
        row.source_campaign_id,
        (leadsByExternalId.get(row.source_campaign_id) ?? 0) + 1,
      )
    }
  }

  const contactIds = Array.from(externalIdByContactId.keys())
  const revenueByExternalId = new Map<string, number>()
  const dealsWonByExternalId = new Map<string, number>()
  if (contactIds.length > 0) {
    const { data: wonDeals, error: dealsError } = await db
      .from('deals')
      .select('contact_id, value')
      .in('contact_id', contactIds)
      .eq('status', 'won')
      .gte('closed_at', range.since.toISOString())
      .lte('closed_at', range.until.toISOString())
    if (dealsError) throw new Error(`Failed to load campaign revenue: ${dealsError.message}`)

    for (const deal of (wonDeals ?? []) as { contact_id: string; value: number }[]) {
      const externalId = externalIdByContactId.get(deal.contact_id)
      if (!externalId) continue
      revenueByExternalId.set(externalId, (revenueByExternalId.get(externalId) ?? 0) + Number(deal.value || 0))
      dealsWonByExternalId.set(externalId, (dealsWonByExternalId.get(externalId) ?? 0) + 1)
    }
  }

  const campaigns: CampaignRow[] = campaignRows.map((c) => {
    const externalId = c.external_id as string
    const agg = sumDailyMetrics(metricsByCampaign.get(c.id as string) ?? [])
    const leads = leadsByExternalId.get(externalId) ?? 0
    const revenue = revenueByExternalId.get(externalId) ?? 0
    const currency = c.currency as string
    const comparable = roiIsComparable(currency, accountCurrency)
    const { roi, roas } = comparable ? computeRoi({ spend: agg.spend, revenue }) : { roi: null, roas: null }
    return {
      id: c.id as string,
      name: c.name as string,
      platform: platformByAdAccount.get(c.ad_account_id as string) ?? 'other',
      effectiveStatus: c.effective_status as string | null,
      currency,
      isManual: c.is_manual as boolean,
      spend: agg.spend,
      impressions: agg.impressions,
      clicks: agg.clicks,
      messagingStarted: agg.messagingStarted,
      leads,
      costPerLead: costPerUnit(agg.spend, leads),
      revenue,
      dealsWon: dealsWonByExternalId.get(externalId) ?? 0,
      roi,
      roas,
      roiComparable: comparable,
    }
  })

  return { campaigns, hasAdAccounts }
}
