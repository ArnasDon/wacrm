import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus, getQrCode } from '@/lib/whatsapp/zapi-api'

/**
 * GET /api/z-api/instance/status
 *
 * Polled by the QR-pairing screen. Z-API's own /status endpoint only
 * ever reports connected/disconnected (no "connecting" state of its
 * own, and no paired-phone field — that's only ever delivered via the
 * ConnectedCallback webhook, persisted separately) so this route
 * fetches the QR code in the same call whenever not yet connected,
 * mirroring the combined status+qrcode shape the uazapi instance
 * status route already returns.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('zapi_instance_id, zapi_token, zapi_client_token, zapi_paired_phone')
      .eq('account_id', accountId)
      .eq('provider', 'zapi')
      .maybeSingle()
    if (configError || !config?.zapi_instance_id || !config?.zapi_token) {
      return NextResponse.json({ error: 'WhatsApp not configured for this account.' }, { status: 400 })
    }

    const instanceId = config.zapi_instance_id
    const token = decrypt(config.zapi_token)
    const clientToken = config.zapi_client_token ? decrypt(config.zapi_client_token) : undefined

    let status
    try {
      status = await getInstanceStatus({ instanceId, token, clientToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Z-API error'
      console.error('[z-api/instance/status] getInstanceStatus failed:', message)
      return NextResponse.json({ error: `Z-API error: ${message}` }, { status: 502 })
    }

    const normalizedStatus = status.connected ? 'connected' : 'disconnected'
    const patch: Record<string, unknown> = { zapi_status: normalizedStatus }
    if (normalizedStatus === 'connected') {
      patch.zapi_connected_at = new Date().toISOString()
    }
    await supabase
      .from('whatsapp_config')
      .update(patch)
      .eq('account_id', accountId)
      .eq('provider', 'zapi')

    let qrCode: string | null = null
    if (!status.connected) {
      try {
        const qr = await getQrCode({ instanceId, token, clientToken })
        qrCode = qr.qrCode
      } catch (err) {
        console.warn('[z-api/instance/status] getQrCode failed (non-fatal):', err)
      }
    }

    return NextResponse.json({
      status: normalizedStatus,
      qrCode,
      pairedPhone: config.zapi_paired_phone ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
