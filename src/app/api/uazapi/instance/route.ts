import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { createInstance, deleteInstance, configureWebhook } from '@/lib/whatsapp/uazapi-api'
import { resolveUazapiPlatformCredentials, UazapiNotConfiguredError } from '@/lib/whatsapp/uazapi-platform-config'
import { resolveBaseUrl } from '@/lib/http/base-url'

/**
 * POST /api/uazapi/instance
 *
 * Provisions a uazapi instance for this account (reseller model — one
 * admin subscription backs every account's instance; UAZAPI_ADMIN_TOKEN
 * never leaves the server). Rejects if the account already has a
 * whatsapp_config row for ANY provider — switching providers requires
 * an explicit disconnect first (see DELETE below), so there's never a
 * moment with two live credential sets for one account.
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
      console.error('[uazapi/instance] error checking existing config:', existingError)
      return NextResponse.json({ error: 'Failed to check existing configuration' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json(
        { error: 'WhatsApp is already configured for this account. Disconnect it first to switch providers.' },
        { status: 409 },
      )
    }

    let baseUrl: string
    let adminToken: string
    try {
      ;({ baseUrl, adminToken } = await resolveUazapiPlatformCredentials())
    } catch (err) {
      if (err instanceof UazapiNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    let created
    try {
      created = await createInstance({ baseUrl, adminToken, name: `wacrm-${accountId}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown uazapi API error'
      console.error('[uazapi/instance] createInstance failed:', message)
      return NextResponse.json({ error: `uazapi API error: ${message}` }, { status: 502 })
    }

    const webhookSecret = crypto.randomBytes(32).toString('hex')
    const webhookUrl = `${resolveBaseUrl(request)}/api/uazapi/webhook/${accountId}/${webhookSecret}`

    const { error: insertError } = await supabase.from('whatsapp_config').insert({
      account_id: accountId,
      user_id: userId,
      provider: 'uazapi',
      uazapi_instance_id: created.instanceId,
      uazapi_token: encrypt(created.token),
      uazapi_webhook_secret: encrypt(webhookSecret),
      uazapi_status: 'disconnected',
      // Legacy generic column (Meta-era) — keep it in a sane state
      // rather than leaving the pre-migration default sitting there.
      status: 'disconnected',
    })
    if (insertError) {
      console.error('[uazapi/instance] error saving config:', insertError)
      // Best-effort cleanup — don't leave an orphaned instance on
      // uazapi's side if we failed to persist locally.
      try {
        await deleteInstance({ baseUrl, token: created.token })
      } catch {
        // already logged above; nothing more useful to do here
      }
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    // Best-effort — the QR-pairing screen still works even if this
    // fails; it just means inbound messages won't arrive until the
    // webhook is retried (Settings can expose a manual retry later).
    try {
      await configureWebhook({ baseUrl, token: created.token, url: webhookUrl })
    } catch (err) {
      console.warn('[uazapi/instance] configureWebhook failed (non-fatal):', err)
    }

    return NextResponse.json({ success: true, instance_id: created.instanceId })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/uazapi/instance
 *
 * Disconnects and removes the uazapi instance, then deletes the local
 * config row entirely — the only supported path to switch providers.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('uazapi_token')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .maybeSingle()
    if (configError) {
      console.error('[uazapi/instance] error loading config for delete:', configError)
      return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 })
    }

    if (config?.uazapi_token) {
      try {
        const token = decrypt(config.uazapi_token)
        const { baseUrl } = await resolveUazapiPlatformCredentials()
        await deleteInstance({ baseUrl, token })
      } catch (err) {
        // Not fatal — we still remove our own record even if uazapi's
        // side errors (e.g. the instance was already gone).
        console.warn('[uazapi/instance] deleteInstance failed (non-fatal):', err)
      }
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
    if (deleteError) {
      console.error('[uazapi/instance] error deleting config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
