// ============================================================
// /api/ads/accounts
//
//   GET  — list this account's connected ad platforms.
//   POST — connect one.
//
// Same shape as /api/account/api-keys: listing is open to any member
// (viewer+, RLS-enforced), connecting is admin+ (it's an account-wide
// credential, same bar as whatsapp_config).
//
// Two kinds of platform, because only one of them has an API:
//
//   - **Meta** takes an act_id + token, and they are verified against
//     Meta *before* anything is stored — a bad pair fails here with
//     Meta's own error message rather than surfacing later as a silent,
//     unexplained sync failure.
//   - **Google / other** take no credential at all. Google's API needs a
//     developer token Google approves over weeks, so its spend is typed
//     in by hand; "connecting" it just creates the placeholder row that
//     manual campaigns hang off (see manual-account.ts) so the platform
//     is visible in Settings instead of only appearing once someone
//     happens to add a campaign.
// ============================================================

import { NextResponse } from 'next/server'
import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { verifyAdAccount } from '@/lib/ads/meta'
import { ensureManualAdAccount, isManualPlatform } from '@/lib/ads/manual-account'

const SAFE_COLUMNS =
  'id, platform, external_id, name, currency, timezone, status, last_error, last_synced_at, token_expires_at, created_at'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    const { data, error } = await ctx.supabase
      .from('ad_accounts')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[GET /api/ads/accounts] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load ad accounts' }, { status: 500 })
    }

    return NextResponse.json({ adAccounts: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(`admin:adAccountConnect:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      platform?: unknown
      externalId?: unknown
      accessToken?: unknown
    } | null

    const platform = body?.platform

    // Manual platforms: nothing to verify, nothing to encrypt. Currency
    // comes from the account itself since there's no external account to
    // ask — and it has to match, or ROI would be comparing two currencies.
    if (isManualPlatform(platform)) {
      const { data: acct } = await ctx.supabase
        .from('accounts')
        .select('default_currency')
        .eq('id', ctx.accountId)
        .maybeSingle()

      const created = await ensureManualAdAccount({
        supabase: ctx.supabase,
        accountId: ctx.accountId,
        userId: ctx.userId,
        platform,
        currency: acct?.default_currency ?? 'USD',
      })
      if (created.error) {
        console.error('[POST /api/ads/accounts] manual upsert error:', created.error)
        return NextResponse.json({ error: 'Failed to save ad account' }, { status: 500 })
      }

      const { data: manualRow } = await ctx.supabase
        .from('ad_accounts')
        .select(SAFE_COLUMNS)
        .eq('id', created.id)
        .single()

      return NextResponse.json({ adAccount: manualRow }, { status: 201 })
    }

    if (platform !== 'meta') {
      return NextResponse.json(
        { error: "'platform' must be one of: meta, google, other" },
        { status: 400 },
      )
    }

    const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : ''
    const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''

    if (!externalId || !accessToken) {
      return NextResponse.json(
        { error: "'externalId' (act_...) and 'accessToken' are required" },
        { status: 400 },
      )
    }
    if (!/^act_\d+$/.test(externalId)) {
      return NextResponse.json(
        { error: "'externalId' must look like 'act_123456789'" },
        { status: 400 },
      )
    }

    let verified: { name: string; currency: string; timezone: string | null }
    try {
      verified = await verifyAdAccount({ adAccountId: externalId, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not verify ad account'
      return NextResponse.json({ error: message }, { status: 422 })
    }

    const { data, error } = await ctx.supabase
      .from('ad_accounts')
      .upsert(
        {
          account_id: ctx.accountId,
          platform: 'meta',
          external_id: externalId,
          name: verified.name,
          currency: verified.currency,
          timezone: verified.timezone,
          access_token_encrypted: encrypt(accessToken),
          status: 'connected',
          last_error: null,
          created_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,platform,external_id' },
      )
      .select(SAFE_COLUMNS)
      .single()

    if (error || !data) {
      console.error('[POST /api/ads/accounts] insert error:', error)
      return NextResponse.json({ error: 'Failed to save ad account' }, { status: 500 })
    }

    return NextResponse.json({ adAccount: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
