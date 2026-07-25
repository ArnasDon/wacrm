// ============================================================
// /api/ads/campaigns/[id]/spend
//
// Spend entries for a manually-tracked campaign (Google Ads, or
// anything else with no API to pull from) — admin+.
//
//   GET    — list the campaign's entries, newest first.
//   PATCH  — record/replace the spend for ONE date.
//   DELETE — remove the entry for one date.
//
// One row per campaign per date, keyed by `ad_metrics_daily`'s
// (campaign_id, date) unique constraint. This replaced an earlier
// "cumulative spend to date" model that stored a single row dated
// *today*: editing it on a later day wrote a second row instead of
// replacing the first, and the /campaigns page sums every row in the
// selected range — so 300 entered on Monday and corrected to 400 on
// Tuesday read as 700, and each later edit compounded from the inflated
// total. Dated entries make the range filter mean what it says: the
// spend shown for "last 7 days" is the spend logged for those days.
//
// The date comes from the client, not from `new Date()` here. The page
// that reads these rows computes its range in the *browser's* timezone
// (see localDayKey in src/lib/dashboard/date-utils.ts), while this
// route runs on a server that is UTC in production — inventing the day
// here would file spend entered after ~19:00 in Peru under tomorrow,
// where a range ending "today" cannot see it.
//
// Only manual campaigns: a synced Meta campaign's spend comes from the
// ads sync, and a hand-edit would be silently overwritten on its next
// run.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseDayKey } from '@/lib/ads/day-key'

/** How many entries the history list shows — roughly a quarter. */
const MAX_ENTRIES = 90

/**
 * Shared guard: the campaign exists, belongs to the caller's account,
 * and is manual. Returns either the campaign or the response to send.
 */
async function loadManualCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  id: string,
): Promise<
  | { campaign: { id: string; currency: string }; error?: undefined }
  | { campaign?: undefined; error: NextResponse }
> {
  const { data, error } = await supabase
    .from('ad_campaigns')
    .select('id, account_id, currency, is_manual')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[api/ads/campaigns/spend] campaign lookup error:', error)
    return { error: NextResponse.json({ error: 'Failed to load campaign' }, { status: 500 }) }
  }
  if (!data || data.account_id !== accountId) {
    return { error: NextResponse.json({ error: 'Campaign not found' }, { status: 404 }) }
  }
  if (!data.is_manual) {
    return {
      error: NextResponse.json(
        { error: 'Only manually-added campaigns can have their spend edited directly' },
        { status: 400 },
      ),
    }
  }
  return { campaign: { id: data.id, currency: data.currency } }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const guard = await loadManualCampaign(ctx.supabase, ctx.accountId, id)
    if (guard.error) return guard.error

    const { data, error } = await ctx.supabase
      .from('ad_metrics_daily')
      .select('date, spend')
      .eq('campaign_id', guard.campaign.id)
      .order('date', { ascending: false })
      .limit(MAX_ENTRIES)

    if (error) {
      console.error('[GET .../spend] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load spend entries' }, { status: 500 })
    }

    return NextResponse.json({ entries: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const limit = checkRateLimit(`admin:manualCampaignSpend:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      spend?: unknown
      date?: unknown
    } | null

    const spend = Number(body?.spend)
    if (!Number.isFinite(spend) || spend < 0) {
      return NextResponse.json({ error: "'spend' must be a non-negative number" }, { status: 400 })
    }

    const date = parseDayKey(body?.date)
    if (!date) {
      return NextResponse.json({ error: "'date' must be a valid YYYY-MM-DD day" }, { status: 400 })
    }

    const guard = await loadManualCampaign(ctx.supabase, ctx.accountId, id)
    if (guard.error) return guard.error

    const { error } = await ctx.supabase.from('ad_metrics_daily').upsert(
      {
        account_id: ctx.accountId,
        campaign_id: guard.campaign.id,
        date,
        spend,
        currency: guard.campaign.currency,
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const limit = checkRateLimit(`admin:manualCampaignSpend:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { date?: unknown } | null
    const date = parseDayKey(body?.date)
    if (!date) {
      return NextResponse.json({ error: "'date' must be a valid YYYY-MM-DD day" }, { status: 400 })
    }

    const guard = await loadManualCampaign(ctx.supabase, ctx.accountId, id)
    if (guard.error) return guard.error

    // origin='manual' in the filter, not just in the RLS policy: an
    // API-synced row for the same day must not be deletable here even
    // if its campaign somehow carries is_manual.
    const { error } = await ctx.supabase
      .from('ad_metrics_daily')
      .delete()
      .eq('campaign_id', guard.campaign.id)
      .eq('date', date)
      .eq('origin', 'manual')

    if (error) {
      console.error('[DELETE .../spend] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete spend entry' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
