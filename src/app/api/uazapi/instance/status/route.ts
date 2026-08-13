import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus } from '@/lib/whatsapp/uazapi-api'
import { resolveUazapiPlatformCredentials } from '@/lib/whatsapp/uazapi-platform-config'
import { maybeSyncContactNames } from '@/lib/whatsapp/contact-name-sync'

/**
 * GET /api/uazapi/instance/status
 *
 * Polled by the QR-pairing screen while `status === 'connecting'`.
 * Persists the live status (and, once connected, the paired phone
 * number + a connected timestamp) so Settings reflects reality without
 * the client needing to separately PATCH anything.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('uazapi_token')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()
    if (configError || !config?.uazapi_token) {
      return NextResponse.json({ error: 'WhatsApp not configured for this account.' }, { status: 400 })
    }

    const token = decrypt(config.uazapi_token)
    const { baseUrl } = await resolveUazapiPlatformCredentials()
    let status
    try {
      status = await getInstanceStatus({ baseUrl, token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown uazapi API error'
      console.error('[uazapi/instance/status] getInstanceStatus failed:', message)
      return NextResponse.json({ error: `uazapi API error: ${message}` }, { status: 502 })
    }

    const patch: Record<string, unknown> = { uazapi_status: status.status }
    if (status.status === 'connected') {
      patch.uazapi_connected_at = new Date().toISOString()
      if (status.pairedPhone) patch.uazapi_paired_phone = status.pairedPhone
    }
    await supabase
      .from('whatsapp_config')
      .update(patch)
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')

    // Fire the same automatic contact-name sync the webhook route
    // uses (see contact-name-sync.ts) right at the moment a number
    // finishes pairing — no need to wait for the next webhook event.
    // Still throttled internally, so this is a no-op once already
    // synced recently. Never allowed to fail the status response.
    if (status.status === 'connected') {
      try {
        await maybeSyncContactNames({ supabaseAdmin: supabase, accountId, baseUrl, token })
      } catch (err) {
        console.error('[uazapi/instance/status] contact name sync check failed:', err)
      }
    }

    return NextResponse.json(status)
  } catch (err) {
    return toErrorResponse(err)
  }
}
