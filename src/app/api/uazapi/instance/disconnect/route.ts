import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { disconnectInstance } from '@/lib/whatsapp/uazapi-api'
import { resolveUazapiPlatformCredentials } from '@/lib/whatsapp/uazapi-platform-config'

/**
 * POST /api/uazapi/instance/disconnect
 *
 * Ends the WhatsApp session but keeps the instance + credentials —
 * distinct from `DELETE /api/uazapi/instance`, which removes the
 * instance entirely. Use this for "log out and re-pair later"; use
 * the DELETE route to switch providers.
 */
export async function POST() {
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

    try {
      const token = decrypt(config.uazapi_token)
      const { baseUrl } = await resolveUazapiPlatformCredentials()
      await disconnectInstance({ baseUrl, token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown uazapi API error'
      console.error('[uazapi/instance/disconnect] disconnectInstance failed:', message)
      return NextResponse.json({ error: `uazapi API error: ${message}` }, { status: 502 })
    }

    await supabase
      .from('whatsapp_config')
      .update({ uazapi_status: 'disconnected' })
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
