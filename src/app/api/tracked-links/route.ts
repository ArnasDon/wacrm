// ============================================================
// /api/tracked-links
//
//   GET  — list this account's tracked links.
//   POST — create one (admin+).
//
// Same shape as /api/ads/accounts: listing is open to any member
// (RLS-enforced), creating is admin+ (a tracked link is a workspace
// setting, same bar as a manual campaign).
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { generateRefCode } from '@/lib/attribution/ref-token'

const SAFE_COLUMNS =
  'id, slug, name, source, campaign_id, whatsapp_number, message_template, clicks, last_clicked_at, created_at'

// Only these sources make sense for a tracked link — meta_ads is
// captured automatically from the webhook referral, and
// manual/unknown/referral aren't a "channel" an operator would point
// a link at.
const LINK_SOURCES = ['google_ads', 'web', 'organic', 'other'] as const

export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    const { data, error } = await ctx.supabase
      .from('tracked_links')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[GET /api/tracked-links] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load tracked links' }, { status: 500 })
    }

    return NextResponse.json({ trackedLinks: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`admin:trackedLinkCreate:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      name?: unknown
      source?: unknown
      campaignId?: unknown
      whatsappNumber?: unknown
      messageTemplate?: unknown
    } | null

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 })
    }

    const source = body?.source
    if (typeof source !== 'string' || !(LINK_SOURCES as readonly string[]).includes(source)) {
      return NextResponse.json(
        { error: `'source' must be one of: ${LINK_SOURCES.join(', ')}` },
        { status: 400 },
      )
    }

    const whatsappNumber =
      typeof body?.whatsappNumber === 'string' ? body.whatsappNumber.replace(/\D/g, '') : ''
    if (whatsappNumber.length < 8) {
      return NextResponse.json(
        { error: "'whatsappNumber' must be a valid phone number with country code" },
        { status: 400 },
      )
    }

    const messageTemplate =
      typeof body?.messageTemplate === 'string' ? body.messageTemplate.trim() : ''

    const campaignId = typeof body?.campaignId === 'string' && body.campaignId ? body.campaignId : null
    if (campaignId) {
      const { data: campaign } = await ctx.supabase
        .from('ad_campaigns')
        .select('id')
        .eq('id', campaignId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (!campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      }
    }

    // Collision odds on a 6-char base36 code are astronomically low
    // (36^6 ≈ 2.2 billion), but the slug is a UNIQUE column across every
    // account on this instance — retry a handful of times rather than
    // fail the whole request on the rare clash.
    let lastError: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = generateRefCode()
      const { data, error } = await ctx.supabase
        .from('tracked_links')
        .insert({
          account_id: ctx.accountId,
          slug,
          name,
          source,
          campaign_id: campaignId,
          whatsapp_number: whatsappNumber,
          message_template: messageTemplate,
          created_by: ctx.userId,
        })
        .select(SAFE_COLUMNS)
        .single()

      if (!error) {
        return NextResponse.json({ trackedLink: data }, { status: 201 })
      }
      lastError = error
      // Only retry on the unique-slug clash; anything else is a real
      // failure worth surfacing immediately.
      if (error.code !== '23505') break
    }

    console.error('[POST /api/tracked-links] insert error:', lastError)
    return NextResponse.json({ error: 'Failed to create tracked link' }, { status: 500 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
