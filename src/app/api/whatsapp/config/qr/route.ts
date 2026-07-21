import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getQrCode } from '@/lib/whatsapp/zapi-api'
import { buildZapiCredentials } from '@/lib/whatsapp/zapi-config'

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('zapi_instance_id, zapi_instance_token, zapi_client_token, connection_status')
      .eq('account_id', accountId)
      .maybeSingle()

    const credentials = config ? buildZapiCredentials(config) : null
    if (configError || !credentials) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Add your Z-API instance first.' },
        { status: 400 },
      )
    }

    const connectionStatus = config?.connection_status
    if (connectionStatus === 'CONNECTED') {
      return NextResponse.json(
        {
          error: 'QR code is only available while the Z-API instance is not connected.',
          connection_status: connectionStatus,
        },
        { status: 400 },
      )
    }

    const qr = await getQrCode(credentials)
    await supabase
      .from('whatsapp_config')
      .update({
        connection_status: 'PENDING_QR',
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)

    return NextResponse.json({
      qr: qr.value,
      mimetype: qr.mimetype ?? 'image/png',
      connection_status: 'PENDING_QR',
      expires_in_seconds: 20,
    })
  } catch (error) {
    console.error('Error fetching QR code:', error)
    return NextResponse.json(
      { error: 'Failed to fetch QR code' },
      { status: 500 },
    )
  }
}
