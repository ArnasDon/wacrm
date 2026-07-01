import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus, configureWebhook } from '@/lib/whatsapp/uazapi-instance'

const DEFAULT_BASE_URL = process.env.UAZAPI_BASE_URL || 'https://nuvtex.uazapi.com'

/**
 * Resolve the caller's account_id from their profile — same helper
 * shape as `/api/whatsapp/config` (kept separate to avoid coupling
 * the two provider routes together).
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

/**
 * Single global webhook URL — every instance across every account
 * points here. Uazapi echoes the instance's own token back in each
 * delivery, which the webhook route matches against the encrypted
 * token on file; there's no per-instance path or query secret to
 * construct (see src/app/api/uazapi/webhook/route.ts).
 */
function webhookUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (!site) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be set to register a Uazapi webhook (Uazapi needs an absolute, publicly reachable URL).'
    )
  }
  return `${site}/api/uazapi/webhook`
}

/**
 * GET /api/uazapi/instance
 *
 * Reports the saved instance's live status (as seen by Uazapi) and
 * metadata — purely informational, shown in Settings.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' },
        { status: 200 },
      )
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()

    if (!config?.uazapi_instance_token) {
      return NextResponse.json({ connected: false, reason: 'no_config' })
    }

    const baseUrl = config.uazapi_base_url || DEFAULT_BASE_URL

    try {
      const status = await getInstanceStatus({
        baseUrl,
        instanceToken: decrypt(config.uazapi_instance_token),
      })

      const newStatus = status.connected && status.loggedIn ? 'connected' : 'disconnected'
      if (newStatus !== config.status) {
        await supabase
          .from('whatsapp_config')
          .update({
            uazapi_connection_status: newStatus,
            status: newStatus,
            connected_at: newStatus === 'connected' ? (config.connected_at ?? new Date().toISOString()) : null,
            uazapi_connected_at: newStatus === 'connected' ? (config.uazapi_connected_at ?? new Date().toISOString()) : null,
          })
          .eq('id', config.id)
      }

      return NextResponse.json({
        connected: status.connected,
        loggedIn: status.loggedIn,
        instance_name: config.uazapi_instance_name,
        base_url: baseUrl,
        connected_at: newStatus === 'connected' ? (config.uazapi_connected_at ?? new Date().toISOString()) : null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Uazapi API error'
      return NextResponse.json({
        connected: false,
        reason: 'uazapi_api_error',
        message,
        instance_name: config.uazapi_instance_name,
        base_url: baseUrl,
      })
    }
  } catch (error) {
    console.error('Error in Uazapi instance GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/uazapi/instance
 *
 * Attaches wacrm to a Uazapi instance token. The instance itself is
 * created AND logged into WhatsApp entirely outside wacrm (directly
 * in the Uazapi panel) — this route only:
 *   1. verifies the token is valid (GET /instance/status),
 *   2. saves it (encrypted) so outbound sends can use it,
 *   3. registers our webhook URL so Uazapi calls us on inbound events.
 * No QR code, no pairing flow — wacrm never drives the WhatsApp
 * session lifecycle.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const instanceToken: string | undefined = body.instance_token?.trim() || undefined
    const baseUrl: string = body.base_url?.trim() || DEFAULT_BASE_URL
    const instanceName: string | undefined = body.instance_name?.trim() || undefined

    if (!instanceToken) {
      return NextResponse.json(
        { error: 'instance_token is required — create and log in the instance in the Uazapi panel first, then paste its token here.' },
        { status: 400 },
      )
    }

    // Verify the token actually works before saving anything, same
    // principle as Meta's verifyPhoneNumber-before-save in
    // /api/whatsapp/config.
    let status
    try {
      status = await getInstanceStatus({ baseUrl, instanceToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Uazapi API error'
      return NextResponse.json(
        { error: `Could not verify that instance token against ${baseUrl}: ${message}` },
        { status: 400 },
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()

    const connected = status.connected && status.loggedIn
    const connectionStatus = connected ? 'connected' : 'disconnected'
    const nowIso = new Date().toISOString()

    let configId: string
    if (existing) {
      configId = existing.id
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update({
          uazapi_instance_token: encrypt(instanceToken),
          uazapi_base_url: baseUrl,
          uazapi_instance_name: instanceName ?? existing.uazapi_instance_name,
          uazapi_connection_status: connectionStatus,
          status: connectionStatus,
          connected_at: connected ? nowIso : null,
          uazapi_connected_at: connected ? nowIso : null,
        })
        .eq('id', configId)
      if (updateError) {
        console.error('Error updating Uazapi whatsapp_config:', updateError)
        return NextResponse.json({ error: 'Failed to save Uazapi configuration' }, { status: 500 })
      }
    } else {
      // First Uazapi connection for this account steals the default
      // outbound slot from an existing Meta row, per the confirmed
      // decision (Uazapi is the default provider whenever it's present).
      const { data: metaConfig } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', accountId)
        .eq('provider', 'meta')
        .eq('is_default', true)
        .maybeSingle()
      if (metaConfig) {
        await supabase.from('whatsapp_config').update({ is_default: false }).eq('id', metaConfig.id)
      }

      const { data: inserted, error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          provider: 'uazapi',
          uazapi_instance_token: encrypt(instanceToken),
          uazapi_base_url: baseUrl,
          uazapi_instance_name: instanceName ?? null,
          uazapi_connection_status: connectionStatus,
          is_default: true,
          status: connectionStatus,
          connected_at: connected ? nowIso : null,
          uazapi_connected_at: connected ? nowIso : null,
        })
        .select('id')
        .single()

      if (insertError || !inserted) {
        console.error('Error inserting Uazapi whatsapp_config:', insertError)
        return NextResponse.json({ error: 'Failed to save Uazapi configuration' }, { status: 500 })
      }
      configId = inserted.id
    }

    // Best-effort — the webhook needs a stable public URL, which only
    // exists once NEXT_PUBLIC_SITE_URL is configured. A failure here
    // doesn't block saving the credentials; the user just needs to
    // retry once the env var is set (surfaced via `webhook_configured: false`).
    let webhookConfigured = false
    try {
      await configureWebhook({
        baseUrl,
        instanceToken,
        url: webhookUrl(),
        events: ['messages', 'connection'],
      })
      webhookConfigured = true
    } catch (err) {
      console.warn('[uazapi/instance] webhook configuration failed:', err instanceof Error ? err.message : err)
    }

    return NextResponse.json({
      connected,
      loggedIn: connected,
      instance_name: instanceName ?? existing?.uazapi_instance_name ?? null,
      base_url: baseUrl,
      webhook_configured: webhookConfigured,
    })
  } catch (error) {
    console.error('Error in Uazapi instance POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/uazapi/instance
 *
 * Detaches wacrm from the instance — removes the saved credentials so
 * wacrm stops sending/receiving through it. Does NOT touch the actual
 * Uazapi instance or its WhatsApp session (no `/instance/disconnect`
 * call) — that lifecycle is entirely managed in the Uazapi panel.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')

    if (deleteError) {
      console.error('Error deleting Uazapi whatsapp_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in Uazapi instance DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
