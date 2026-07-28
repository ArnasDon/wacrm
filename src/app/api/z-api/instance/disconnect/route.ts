import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { disconnectInstance } from '@/lib/whatsapp/zapi-api'

/**
 * POST /api/z-api/instance/disconnect
 *
 * Ends the WhatsApp session but keeps the instance credentials —
 * distinct from `DELETE /api/z-api/instance`, which forgets them
 * entirely. Use this for "log out and re-pair later"; use DELETE to
 * switch providers.
 */
export async function POST() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('zapi_instance_id, zapi_token, zapi_client_token')
      .eq('account_id', accountId)
      .eq('provider', 'zapi')
      .maybeSingle()
    if (configError || !config?.zapi_instance_id || !config?.zapi_token) {
      return NextResponse.json({ error: 'WhatsApp not configured for this account.' }, { status: 400 })
    }

    try {
      const token = decrypt(config.zapi_token)
      const clientToken = config.zapi_client_token ? decrypt(config.zapi_client_token) : undefined
      await disconnectInstance({ instanceId: config.zapi_instance_id, token, clientToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Z-API error'
      console.error('[z-api/instance/disconnect] disconnectInstance failed:', message)
      return NextResponse.json({ error: `Z-API error: ${message}` }, { status: 502 })
    }

    await supabase
      .from('whatsapp_config')
      .update({ zapi_status: 'disconnected' })
      .eq('account_id', accountId)
      .eq('provider', 'zapi')

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
