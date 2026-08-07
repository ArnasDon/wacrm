// ============================================================
// GET /api/whatsapp/evolution/qr
//
// Single poll used while the QR modal is open. Checks connection
// status via GET /instance/info (the only endpoint that actually
// reports it — /instance/qr never does) and, only while still
// disconnected, fetches a QR image to display.
//
// Once connected we flip whatsapp_config.status here too —
// belt-and-braces alongside the PairSuccess webhook event, in case
// this deployment's webhook URL isn't reachable from the Evolution Go
// server (e.g. it's on a different network) but this poll, made from
// the admin's own browser through the same Next.js server, is.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceQr, getInstanceInfo } from '@/lib/whatsapp/evolution-api'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select(
        'id, provider, status, evolution_api_url, evolution_instance_uuid, evolution_instance_token, evolution_admin_token'
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error || !config || config.provider !== 'evolution') {
      return NextResponse.json(
        { error: 'No Evolution Go instance configured' },
        { status: 404 }
      )
    }

    const apiUrl = config.evolution_api_url as string
    const instanceUuid = config.evolution_instance_uuid as string
    let instanceToken: string
    let adminToken: string
    try {
      instanceToken = decrypt(config.evolution_instance_token as string)
      adminToken = decrypt(config.evolution_admin_token as string)
    } catch (err) {
      console.error('[whatsapp/evolution/qr GET] token decrypt failed:', err)
      return NextResponse.json(
        { error: 'Stored instance token cannot be decrypted (ENCRYPTION_KEY changed?)' },
        { status: 500 }
      )
    }

    const info = await getInstanceInfo({ apiUrl, adminToken, instanceUuid })

    if (info.connected) {
      if (config.status !== 'connected') {
        await supabase
          .from('whatsapp_config')
          .update({ status: 'connected', connected_at: new Date().toISOString() })
          .eq('id', config.id)
      }
      return NextResponse.json({ connected: true, base64: null, code: null })
    }

    const qr = await getInstanceQr({ apiUrl, instanceToken })
    return NextResponse.json({ connected: false, base64: qr.base64, code: qr.code })
  } catch (err) {
    return toErrorResponse(err)
  }
}
