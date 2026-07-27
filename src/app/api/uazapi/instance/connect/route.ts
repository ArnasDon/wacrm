import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { connectInstance } from '@/lib/whatsapp/uazapi-api'
import { resolveUazapiPlatformCredentials } from '@/lib/whatsapp/uazapi-platform-config'

/**
 * POST /api/uazapi/instance/connect
 *
 * Starts (or restarts) pairing for this account's uazapi instance and
 * returns a QR image or pairing code. Body: `{ phone?: string }` — set
 * `phone` to request a pairing CODE instead of a QR image.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('uazapi_token')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()
    if (configError || !config?.uazapi_token) {
      return NextResponse.json(
        { error: 'uazapi instance not created yet. Reload the page and try again.' },
        { status: 400 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : undefined

    const token = decrypt(config.uazapi_token)
    const { baseUrl } = await resolveUazapiPlatformCredentials()
    let result
    try {
      result = await connectInstance({ baseUrl, token, phone })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown uazapi API error'
      console.error('[uazapi/instance/connect] connectInstance failed:', message)
      return NextResponse.json({ error: `uazapi API error: ${message}` }, { status: 502 })
    }

    await supabase
      .from('whatsapp_config')
      .update({ uazapi_status: result.status })
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
