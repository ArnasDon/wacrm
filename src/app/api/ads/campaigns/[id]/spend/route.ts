// ============================================================
// PATCH /api/ads/campaigns/[id]/spend
//
// Update a manual campaign's cumulative spend-to-date — admin+.
//
// Overwrites the single `ad_metrics_daily` row dated today for this
// campaign (upsert on the campaign_id+date unique key from migration
// 038) rather than adding a new one, matching the "how much have you
// spent so far" model the create endpoint establishes.
//
// Only manual campaigns can be edited here — a synced Meta campaign's
// spend comes from the ads sync and editing it by hand here would be
// silently overwritten (or would drift from) the next sync run.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { localDayKey } from '@/lib/dashboard/date-utils'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const limit = checkRateLimit(`admin:manualCampaignSpend:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { spend?: unknown } | null
    const spend = Number(body?.spend)
    if (!Number.isFinite(spend) || spend < 0) {
      return NextResponse.json({ error: "'spend' must be a non-negative number" }, { status: 400 })
    }

    const { data: campaign, error: campaignError } = await ctx.supabase
      .from('ad_campaigns')
      .select('id, account_id, currency, is_manual')
      .eq('id', id)
      .maybeSingle()

    if (campaignError) {
      console.error('[PATCH .../spend] campaign lookup error:', campaignError)
      return NextResponse.json({ error: 'Failed to load campaign' }, { status: 500 })
    }
    if (!campaign || campaign.account_id !== ctx.accountId) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    if (!campaign.is_manual) {
      return NextResponse.json(
        { error: 'Only manually-added campaigns can have their spend edited directly' },
        { status: 400 },
      )
    }

    const { error } = await ctx.supabase.from('ad_metrics_daily').upsert(
      {
        account_id: ctx.accountId,
        campaign_id: campaign.id,
        date: localDayKey(new Date()),
        spend,
        currency: campaign.currency,
        origin: 'manual',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'campaign_id,date' },
    )

    if (error) {
      console.error('[PATCH .../spend] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save spend' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
