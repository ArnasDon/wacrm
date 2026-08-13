import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus, disconnectInstance, configureWebhook } from '@/lib/whatsapp/zapi-api'
import { resolveBaseUrl } from '@/lib/http/base-url'

// Service-role client — needed to check whether a zapi_instance_id is
// already claimed by a DIFFERENT account. Under RLS the caller's own
// session can't see other accounts' whatsapp_config rows, so that
// conflict would otherwise only surface as an opaque unique-constraint
// 500 at insert time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * POST /api/z-api/instance
 *
 * Z-API is bring-your-own-instance (unlike uazapi's reseller model):
 * the account owner creates their own instance in Z-API's dashboard
 * and pastes Instance ID + Token (+ optional Client-Token) here. This
 * route never creates or deletes anything on Z-API's side — it just
 * validates the credentials, registers our webhook against the
 * existing instance, and saves them encrypted.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const { data: existing, error: existingError } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) {
      console.error('[z-api/instance] error checking existing config:', existingError)
      return NextResponse.json({ error: 'Failed to check existing configuration' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json(
        { error: 'WhatsApp is already configured for this account. Disconnect it first to switch providers.' },
        { status: 409 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const instanceId = typeof body?.instanceId === 'string' ? body.instanceId.trim() : ''
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    const clientToken = typeof body?.clientToken === 'string' && body.clientToken.trim() ? body.clientToken.trim() : undefined

    if (!instanceId || !token) {
      return NextResponse.json({ error: 'Instance ID and Token are both required.' }, { status: 400 })
    }

    // Reject if another account already claimed this instance —
    // mirrors the phone_number_id ownership check in
    // /api/whatsapp/config for the same "one number, one account"
    // reason (a shared instance would break the webhook's account
    // lookup and message routing).
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('zapi_instance_id', instanceId)
      .neq('account_id', accountId)
      .maybeSingle()
    if (claimedError) {
      console.error('[z-api/instance] error checking instance ownership:', claimedError)
      return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
    }
    if (claimed) {
      return NextResponse.json(
        { error: 'This Z-API instance is already connected to another account on this deployment.' },
        { status: 409 },
      )
    }

    // Verify the credentials actually work before saving anything —
    // same "fail fast with a clear message" precedent as Meta's
    // verifyPhoneNumber call in /api/whatsapp/config.
    try {
      await getInstanceStatus({ instanceId, token, clientToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Z-API error'
      return NextResponse.json({ error: `Z-API rejected the credentials: ${message}` }, { status: 400 })
    }

    const webhookSecret = crypto.randomBytes(32).toString('hex')
    const webhookUrl = `${resolveBaseUrl(request)}/api/z-api/webhook/${accountId}/${webhookSecret}`

    // Best-effort — the connect screen still works even if this fails;
    // it just means inbound messages/status/connection events won't
    // arrive until the webhook is reconfigured (same non-fatal
    // treatment as the uazapi route's configureWebhook call).
    try {
      await configureWebhook({ instanceId, token, clientToken, url: webhookUrl })
    } catch (err) {
      console.warn('[z-api/instance] configureWebhook failed (non-fatal):', err)
    }

    const { error: insertError } = await supabase.from('whatsapp_config').insert({
      account_id: accountId,
      user_id: userId,
      provider: 'zapi',
      zapi_instance_id: instanceId,
      zapi_token: encrypt(token),
      zapi_client_token: clientToken ? encrypt(clientToken) : null,
      zapi_webhook_secret: encrypt(webhookSecret),
      zapi_status: 'disconnected',
      // Legacy generic column (Meta-era) — keep it in a sane state
      // rather than leaving the pre-migration default sitting there.
      status: 'disconnected',
    })
    if (insertError) {
      console.error('[z-api/instance] error saving config:', insertError)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/z-api/instance
 *
 * Disconnects the WhatsApp session (best-effort) and deletes the
 * local config row. Unlike uazapi, there's no remote "delete instance"
 * call — the instance itself lives in the customer's own Z-API
 * account and is theirs to manage; we only ever disconnect the
 * session and forget our local credentials.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('zapi_instance_id, zapi_token, zapi_client_token')
      .eq('account_id', accountId)
      .eq('provider', 'zapi')
      .maybeSingle()
    if (configError) {
      console.error('[z-api/instance] error loading config for delete:', configError)
      return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 })
    }

    if (config?.zapi_instance_id && config?.zapi_token) {
      try {
        const token = decrypt(config.zapi_token)
        const clientToken = config.zapi_client_token ? decrypt(config.zapi_client_token) : undefined
        await disconnectInstance({ instanceId: config.zapi_instance_id, token, clientToken })
      } catch (err) {
        console.warn('[z-api/instance] disconnectInstance failed (non-fatal):', err)
      }
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'zapi')
    if (deleteError) {
      console.error('[z-api/instance] error deleting config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
