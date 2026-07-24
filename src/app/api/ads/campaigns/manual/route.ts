// ============================================================
// POST /api/ads/campaigns/manual
//
// Add a manually-tracked campaign for a platform with no API (Google
// Ads today; "Other" for anything else) — admin+.
//
// Meta campaigns arrive through the sync (src/lib/ads/sync.ts) against
// a real `ad_accounts` connection. A manual campaign needs the same
// parent row to satisfy `ad_campaigns.ad_account_id NOT NULL`, but
// there is nothing to authenticate — so this endpoint gets-or-creates
// one placeholder `ad_accounts` row per (account, platform) with no
// access token, rather than routing through the Meta-only connect
// flow in /api/ads/accounts.
//
// Takes an initial spend figure so the campaign is useful immediately
// instead of appearing with a cost-per-lead of "n/d" until a separate
// step. It's recorded as one `ad_metrics_daily` row dated today
// (`origin: 'manual'`) representing *cumulative spend to date* rather
// than a daily breakdown — Google/other platforms have no per-day feed
// here, so "how much have you spent so far" is the honest granularity
// to ask an operator to track by hand. Editing it later
// (PATCH /api/ads/campaigns/[id]/spend) overwrites that same row.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { localDayKey } from '@/lib/dashboard/date-utils'

const MANUAL_PLATFORMS = ['google', 'other'] as const

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`admin:manualCampaign:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      platform?: unknown
      name?: unknown
      currency?: unknown
      spend?: unknown
    } | null

    const platform = body?.platform
    if (platform !== 'google' && platform !== 'other') {
      return NextResponse.json(
        { error: `'platform' must be one of: ${MANUAL_PLATFORMS.join(', ')}` },
        { status: 400 },
      )
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 })
    }

    const currency = typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : ''
    if (!/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "'currency' must be a 3-letter code" }, { status: 400 })
    }

    const spend = Number(body?.spend ?? 0)
    if (!Number.isFinite(spend) || spend < 0) {
      return NextResponse.json({ error: "'spend' must be a non-negative number" }, { status: 400 })
    }

    // One placeholder ad_accounts row per (account, platform) — reused
    // across every manual campaign on that platform rather than one
    // per campaign, since there's no real external account to key on.
    const { data: adAccount, error: adAccountError } = await ctx.supabase
      .from('ad_accounts')
      .upsert(
        {
          account_id: ctx.accountId,
          platform,
          external_id: 'manual',
          name: platform === 'google' ? 'Google Ads (manual)' : 'Other (manual)',
          currency,
          status: 'connected',
          created_by: ctx.userId,
        },
        { onConflict: 'account_id,platform,external_id', ignoreDuplicates: false },
      )
      .select('id')
      .single()

    if (adAccountError || !adAccount) {
      console.error('[POST /api/ads/campaigns/manual] ad_accounts upsert error:', adAccountError)
      return NextResponse.json({ error: 'Failed to save campaign' }, { status: 500 })
    }

    const { data: campaign, error: campaignError } = await ctx.supabase
      .from('ad_campaigns')
      .insert({
        account_id: ctx.accountId,
        ad_account_id: adAccount.id,
        // Random, opaque — nothing in any external system names a
        // manual campaign, so this only has to be unique per ad_account
        // and stable as the join key stamped onto contacts/attribution.
        external_id: crypto.randomUUID(),
        name,
        effective_status: 'ACTIVE',
        currency,
        is_manual: true,
      })
      .select('id, external_id')
      .single()

    if (campaignError || !campaign) {
      console.error('[POST /api/ads/campaigns/manual] ad_campaigns insert error:', campaignError)
      return NextResponse.json({ error: 'Failed to save campaign' }, { status: 500 })
    }

    if (spend > 0) {
      const { error: metricsError } = await ctx.supabase.from('ad_metrics_daily').insert({
        account_id: ctx.accountId,
        campaign_id: campaign.id,
        date: localDayKey(new Date()),
        spend,
        currency,
        origin: 'manual',
      })
      if (metricsError) {
        console.error('[POST /api/ads/campaigns/manual] metrics insert error:', metricsError)
        // The campaign itself saved fine; spend can be added via the
        // edit endpoint. Not worth failing the whole request over.
      }
    }

    return NextResponse.json({ campaignId: campaign.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
