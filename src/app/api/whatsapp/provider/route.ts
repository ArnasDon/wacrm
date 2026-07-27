import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/whatsapp/provider
 *
 * Read-only lookup of which provider (if any) this account has
 * configured — the Settings panel uses this to decide whether to
 * render the provider picker, the Meta credentials form, or the
 * uazapi QR-pairing screen, without needing to know each provider's
 * table shape.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { data, error } = await supabase
      .from('whatsapp_config')
      .select('provider')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[whatsapp/provider] error:', error)
      return NextResponse.json({ error: 'Failed to load provider' }, { status: 500 })
    }

    return NextResponse.json({ provider: data?.provider ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
